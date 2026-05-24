"""LLM client service for ontology extraction.

Provides a unified interface to OpenAI-compatible LLM APIs (OpenAI, Azure
OpenAI, Anthropic-via-OpenAI-compatible proxy) with structured JSON output,
retry logic, and specialised prompts for entity/property extraction and
ontology assembly.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# System prompts
# ---------------------------------------------------------------------------

_ENTITY_EXTRACTION_SYSTEM = """You are an expert ontology engineer. Your task is to extract ontology classes \
and entities from a text passage.

For each entity you identify, return a JSON object with these fields:
- "uri": a suggested URI fragment for the entity (PascalCase, no spaces)
- "label": a human-readable label
- "description": a one-sentence description of what this entity represents
- "type": one of "class", "individual"
- "parent": the URI fragment of a parent class if an obvious superclass exists, otherwise null

Return a JSON object with a single key "entities" whose value is an array of these objects.
Only include entities that are clearly described in the text. Do not invent entities.

Example output:
{
  "entities": [
    {"uri": "Vehicle", "label": "Vehicle", "description": "A motorised means of transport.", "type": "class", "parent": null},
    {"uri": "Car", "label": "Car", "description": "A four-wheeled passenger vehicle.", "type": "class", "parent": "Vehicle"}
  ]
}"""

_PROPERTY_EXTRACTION_SYSTEM = """You are an expert ontology engineer. Given a text passage and a set of \
already-identified entities, extract the properties and relationships that connect them.

For each property/relationship, return a JSON object with:
- "uri": a suggested URI fragment for the property (camelCase)
- "label": a human-readable label
- "domain": the URI fragment of the source entity (must be one of the provided entities)
- "range": the URI fragment of the target entity, or an XSD datatype (e.g. "xsd:string", "xsd:integer", "xsd:float", "xsd:dateTime")
- "description": a one-sentence description

Return a JSON object with a single key "properties" whose value is an array of these objects.
Only include properties clearly supported by the text.

Example output:
{
  "properties": [
    {"uri": "hasEngine", "label": "has engine", "domain": "Car", "range": "Engine", "description": "Relates a car to its engine."},
    {"uri": "maxSpeed", "label": "max speed", "domain": "Vehicle", "range": "xsd:float", "description": "Maximum speed in km/h."}
  ]
}"""

_ASSEMBLY_SYSTEM = """You are an expert ontology engineer. You are given a collection of extracted \
entities and properties that may contain duplicates, overlaps, and inconsistencies because they \
were extracted from multiple text chunks independently.

Your job is to:
1. Merge duplicate entities that refer to the same concept (even if labels differ slightly).
2. Establish a coherent class hierarchy (set parent/child relationships).
3. Remove clearly erroneous or redundant entries.
4. Normalise URIs: use PascalCase for classes, camelCase for properties.
5. If an "existing_classes" list is provided, prefer reusing those URIs where appropriate rather than creating new ones.

Return a JSON object with three keys:
- "classes": array of {uri, label, description, parent} objects
- "properties": array of {uri, label, domain, range, description} objects
- "relationships": array of {source_uri, target_uri, type} where type is one of:
  SUBCLASS_OF, HAS_PROPERTY, DOMAIN, RANGE, EQUIVALENT_TO, RELATED_TO, DISJOINT_WITH

Make sure every class referenced in a property's domain/range actually appears in the classes list.

Be thorough but conservative: only include concepts with strong textual evidence."""


# ---------------------------------------------------------------------------
# LLMClient
# ---------------------------------------------------------------------------

class LLMClient:
    """Async client for OpenAI-compatible LLM APIs."""

    MAX_RETRIES = 3
    BASE_BACKOFF = 1.0  # seconds

    def __init__(self) -> None:
        settings = get_settings()
        self._api_base = settings.LLM_API_BASE.rstrip("/")
        self._api_key = settings.LLM_API_KEY
        self._model = settings.LLM_MODEL
        self._provider = getattr(settings, "LLM_PROVIDER", "openai").lower()
        self._api_version = getattr(settings, "LLM_API_VERSION", "2024-10-21")
        self._max_tokens = getattr(settings, "LLM_MAX_TOKENS", 16384)

        headers: dict[str, str] = {
            "Content-Type": "application/json",
        }
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
            # Azure uses a different header
            if self._provider == "azure":
                headers["api-key"] = self._api_key

        self._client = httpx.AsyncClient(
            base_url=self._api_base,
            headers=headers,
            timeout=httpx.Timeout(120.0, connect=30.0),
        )

    async def close(self) -> None:
        """Close the underlying HTTP client."""
        await self._client.aclose()

    # ------------------------------------------------------------------
    # Core completion
    # ------------------------------------------------------------------

    async def complete(
        self,
        system_prompt: str,
        user_prompt: str,
        json_schema: dict | None = None,
        max_tokens: int | None = None,
    ) -> dict | str:
        """Send a chat completion request with retry logic.

        Args:
            system_prompt: System-level instruction.
            user_prompt: User message / input text.
            json_schema: If provided, request structured JSON output and
                parse the response into a dict.
            max_tokens: Override the default max_tokens for this call.

        Returns:
            Parsed dict when *json_schema* is provided or the response
            looks like JSON, otherwise the raw text response.
        """
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        body: dict[str, Any] = {
            "model": self._model,
            "messages": messages,
            "temperature": 0.1,
            "max_tokens": max_tokens if max_tokens is not None else self._max_tokens,
        }

        if json_schema is not None:
            body["response_format"] = {"type": "json_object"}

        endpoint = self._resolve_endpoint()

        last_exc: Exception | None = None
        for attempt in range(1, self.MAX_RETRIES + 1):
            try:
                logger.debug(
                    "LLM request attempt %d/%d to %s (model=%s, max_tokens=%d)",
                    attempt,
                    self.MAX_RETRIES,
                    endpoint,
                    self._model,
                    body["max_tokens"],
                )
                resp = await self._client.post(endpoint, json=body)
                resp.raise_for_status()
                data = resp.json()

                content = self._extract_content(data)

                # Detect truncation via finish_reason
                finish_reason = self._get_finish_reason(data)
                logger.info(
                    "LLM response: %d chars, finish_reason=%s",
                    len(content),
                    finish_reason,
                )
                if finish_reason == "length":
                    logger.warning(
                        "LLM response was TRUNCATED (hit max_tokens=%d). "
                        "Response length: %d chars. Will attempt JSON recovery.",
                        body["max_tokens"],
                        len(content),
                    )

                if json_schema is not None or self._looks_like_json(content):
                    return self._parse_json(content)
                return content

            except httpx.HTTPStatusError as exc:
                last_exc = exc
                status = exc.response.status_code
                # Retry on rate-limit or server errors
                if status in (429, 500, 502, 503, 504):
                    wait = self.BASE_BACKOFF * (2 ** (attempt - 1))
                    logger.warning(
                        "LLM API returned %d, retrying in %.1fs (attempt %d/%d)",
                        status,
                        wait,
                        attempt,
                        self.MAX_RETRIES,
                    )
                    await asyncio.sleep(wait)
                    continue
                raise
            except (httpx.RequestError, httpx.TimeoutException) as exc:
                last_exc = exc
                wait = self.BASE_BACKOFF * (2 ** (attempt - 1))
                logger.warning(
                    "LLM request error: %s, retrying in %.1fs (attempt %d/%d)",
                    exc,
                    wait,
                    attempt,
                    self.MAX_RETRIES,
                )
                await asyncio.sleep(wait)
                continue

        raise RuntimeError(
            f"LLM API call failed after {self.MAX_RETRIES} attempts"
        ) from last_exc

    # ------------------------------------------------------------------
    # Ontology extraction helpers
    # ------------------------------------------------------------------

    async def extract_entities(
        self,
        text: str,
        domain_context: str = "",
    ) -> list[dict]:
        """Extract ontology entities/classes from a text chunk.

        Args:
            text: Source text to analyse.
            domain_context: Optional description of the domain to guide extraction.

        Returns:
            List of entity dicts with keys: uri, label, description, type, parent.
        """
        user_prompt_parts = []
        if domain_context:
            user_prompt_parts.append(f"Domain context: {domain_context}\n")
        user_prompt_parts.append(f"Text to analyse:\n\n{text}")

        result = await self.complete(
            system_prompt=_ENTITY_EXTRACTION_SYSTEM,
            user_prompt="\n".join(user_prompt_parts),
            json_schema={"type": "object"},
        )

        if isinstance(result, dict):
            entities = result.get("entities", [])
        else:
            entities = []

        logger.info("Extracted %d entities from text chunk", len(entities))
        return entities

    async def extract_properties(
        self,
        text: str,
        entities: list[dict],
    ) -> list[dict]:
        """Extract properties and relationships between known entities.

        Args:
            text: Source text to analyse.
            entities: Previously extracted entity dicts.

        Returns:
            List of property dicts with keys: uri, label, domain, range, description.
        """
        entity_summary = json.dumps(
            [{"uri": e.get("uri"), "label": e.get("label")} for e in entities],
            indent=2,
        )
        user_prompt = (
            f"Known entities:\n{entity_summary}\n\n"
            f"Text to analyse:\n\n{text}"
        )

        result = await self.complete(
            system_prompt=_PROPERTY_EXTRACTION_SYSTEM,
            user_prompt=user_prompt,
            json_schema={"type": "object"},
        )

        if isinstance(result, dict):
            properties = result.get("properties", [])
        else:
            properties = []

        logger.info("Extracted %d properties from text chunk", len(properties))
        return properties

    async def assemble_ontology(
        self,
        entities: list[dict],
        properties: list[dict],
        existing_classes: list[str] | None = None,
    ) -> dict:
        """Merge, deduplicate, and assemble a coherent ontology structure.

        Args:
            entities: All extracted entities (potentially with duplicates).
            properties: All extracted properties.
            existing_classes: URIs of classes already in the graph.

        Returns:
            Dict with keys: classes, properties, relationships.
        """
        if existing_classes is None:
            existing_classes = []

        user_prompt = json.dumps(
            {
                "extracted_entities": entities,
                "extracted_properties": properties,
                "existing_classes": existing_classes,
            },
            indent=2,
        )

        result = await self.complete(
            system_prompt=_ASSEMBLY_SYSTEM,
            user_prompt=user_prompt,
            json_schema={"type": "object"},
        )

        if not isinstance(result, dict):
            raise ValueError("LLM assembly did not return a valid JSON object")

        # Ensure expected keys exist
        result.setdefault("classes", [])
        result.setdefault("properties", [])
        result.setdefault("relationships", [])

        logger.info(
            "Assembled ontology: %d classes, %d properties, %d relationships",
            len(result["classes"]),
            len(result["properties"]),
            len(result["relationships"]),
        )
        return result

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _resolve_endpoint(self) -> str:
        """Return the chat completions endpoint path."""
        if self._provider == "azure":
            # If the base URL already contains the deployment path, just
            # append the completions route.  Otherwise build the full path
            # from the resource root + model name.
            if "/openai/deployments/" in self._api_base:
                endpoint = f"/chat/completions?api-version={self._api_version}"
            else:
                endpoint = (
                    f"/openai/deployments/{self._model}"
                    f"/chat/completions?api-version={self._api_version}"
                )
            logger.info("Azure endpoint resolved: %s%s", self._api_base, endpoint)
            return endpoint
        # Standard OpenAI-compatible endpoint
        endpoint = "/v1/chat/completions"
        logger.info("LLM endpoint resolved: %s%s", self._api_base, endpoint)
        return endpoint

    @staticmethod
    def _extract_content(data: dict) -> str:
        """Pull the assistant message content from the API response."""
        try:
            return data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise ValueError(
                f"Unexpected API response structure: {data}"
            ) from exc

    @staticmethod
    def _get_finish_reason(data: dict) -> str:
        """Return the finish_reason from the API response, or 'unknown'."""
        try:
            return data["choices"][0].get("finish_reason", "unknown") or "unknown"
        except (KeyError, IndexError, TypeError):
            return "unknown"

    @staticmethod
    def _looks_like_json(text: str) -> bool:
        stripped = text.strip()
        return (stripped.startswith("{") and stripped.endswith("}")) or (
            stripped.startswith("[") and stripped.endswith("]")
        )

    @staticmethod
    def _parse_json(text: str) -> dict:
        """Parse a JSON string, handling markdown fences and truncation.

        Recovery strategy when ``json.loads`` fails:
        1. Try the ``json_repair`` library (handles most malformed JSON).
        2. Fall back to manual truncation recovery (trim to last ``}``
           and close remaining open brackets/braces).
        """
        cleaned = text.strip()
        # Strip ```json ... ``` wrappers the LLM may add
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            cleaned = "\n".join(lines)

        # 1. Standard parse
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            pass

        logger.warning(
            "Standard JSON parse failed (%d chars). Attempting recovery ...",
            len(cleaned),
        )

        # 2. json-repair library
        try:
            import json_repair
            result = json_repair.loads(cleaned)
            if isinstance(result, dict):
                logger.warning(
                    "Recovered malformed/truncated JSON via json-repair (%d chars).",
                    len(cleaned),
                )
                return result
            if isinstance(result, list):
                logger.warning(
                    "json-repair returned a list; wrapping in dict (%d chars).",
                    len(cleaned),
                )
                return {"items": result}
        except Exception as exc:
            logger.debug("json-repair failed: %s", exc)

        # 3. Manual truncation recovery
        recovered = LLMClient._recover_truncated_json(cleaned)
        if recovered is not None:
            logger.warning(
                "Recovered truncated JSON by closing structure (%d chars).",
                len(cleaned),
            )
            return recovered

        logger.error(
            "All JSON recovery attempts failed (%d chars): %.200s...",
            len(cleaned),
            cleaned,
        )
        raise ValueError(f"LLM returned invalid JSON: {cleaned[:200]}...")

    @staticmethod
    def _recover_truncated_json(text: str) -> dict | None:
        """Attempt to recover a truncated JSON object.

        Trims to the last ``}`` and closes any remaining open
        brackets / braces.
        """
        if not text.lstrip().startswith("{"):
            return None

        last_brace = text.rfind("}")
        if last_brace == -1:
            return None

        candidate = text[: last_brace + 1]
        open_braces = candidate.count("{") - candidate.count("}")
        open_brackets = candidate.count("[") - candidate.count("]")

        if open_braces < 0 or open_brackets < 0:
            return None

        candidate += "]" * open_brackets + "}" * open_braces

        try:
            result = json.loads(candidate)
            if isinstance(result, dict):
                return result
        except json.JSONDecodeError:
            pass

        return None
