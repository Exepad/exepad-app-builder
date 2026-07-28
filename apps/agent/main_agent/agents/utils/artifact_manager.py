"""
Artifact Manager for schema and config artifact operations.

This module provides utilities for:
- Initializing schema artifacts at workflow start
- Loading artifacts as dict/string
- Saving config artifacts

Used by orchestrator/workflow code, NOT as agent tools.
"""

import json
import structlog
from pathlib import Path
from typing import Any, Optional
from google.adk.agents.callback_context import CallbackContext
from google.adk.agents.invocation_context import InvocationContext
from google import genai

logger = structlog.get_logger(__name__)

# Artifact naming conventions
SCHEMA_ARTIFACT = "full_schema.json"
CATALOG_ARTIFACT = "schema_catalog.json"
PAGE_PREFIX = "page:"
WEBAPP_PREFIX = ""
THEME_PREFIX = "theme:"


class ArtifactManager:
    """
    Manages artifacts from orchestrator/workflow code.

    This class provides static methods for artifact operations.
    Agents do NOT use this directly - they use FunctionTools for saving.
    """

    # Path to schemas directory
    _schemas_dir: Optional[Path] = None

    @classmethod
    def _get_schemas_dir(cls) -> Path:
        """Get the schemas directory path."""
        if cls._schemas_dir is None:
            cls._schemas_dir = Path(__file__).parent.parent.parent / "schemas" / "full_schema_model"
        return cls._schemas_dir

    @staticmethod
    async def initialize_schema_artifacts(callback_context: CallbackContext) -> None:
        """
        Loads local schema and saves it as an artifact using the correct 'artifact=' param.
        """
        schemas_dir = ArtifactManager._get_schemas_dir()
        schema_path = schemas_dir / "full_schema.json"

        if schema_path.exists():
            try:
                # 1. Read bytes
                with open(schema_path, "rb") as f:
                    schema_bytes = f.read()

                # 2. Create the Part object (Matches your Docs)
                schema_part = genai.types.Part.from_bytes(
                    data=schema_bytes, mime_type="application/json"
                )

                # 3. Save using 'artifact=' (Matches your Docs)
                version = await callback_context.save_artifact(
                    filename=SCHEMA_ARTIFACT, artifact=schema_part
                )

                logger.info(f"✅ Schema saved: {SCHEMA_ARTIFACT} (v{version})")

                # OPTIONAL: Verify it exists in the list immediately
                files = await callback_context.list_artifacts()
                logger.debug(f"Current Artifacts: {files}")

            except Exception as e:
                logger.error(f"Failed to store schema: {e}")
                raise
        else:
            logger.warning(f"File not found: {schema_path}")

    @staticmethod
    async def initialize_schema_artifacts_manual(ctx: InvocationContext) -> None:
        """
        Loads local schema and saves it as an artifact using the correct 'artifact=' param.
        """
        schemas_dir = ArtifactManager._get_schemas_dir()
        schema_path = schemas_dir / "full_schema.json"

        if schema_path.exists():
            try:
                # 1. Read bytes
                with open(schema_path, "rb") as f:
                    schema_bytes = f.read()

                # 2. Create the Part object (Matches your Docs)
                schema_part = genai.types.Part.from_bytes(data=schema_bytes, mime_type="text/plain")

                # 3. Save using 'artifact=' (Matches your Docs)
                version = await ctx.artifact_service.save_artifact(
                    session_id=ctx.session.id,
                    user_id=ctx.session.user_id,
                    app_name=ctx.session.app_name,
                    filename=SCHEMA_ARTIFACT,
                    artifact=schema_part,
                )

                logger.info(f"✅ Schema saved: {SCHEMA_ARTIFACT} (v{version})")

                # OPTIONAL: Verify it exists in the list immediately
                files = await ctx.artifact_service.list_artifact_keys(
                    session_id=ctx.session.id,
                    user_id=ctx.session.user_id,
                    app_name=ctx.session.app_name,
                )
                logger.debug(f"Current Artifacts: {files}")

            except Exception as e:
                logger.error(f"Failed to store schema: {e}")
                raise
        else:
            logger.warning(f"File not found: {schema_path}")

    @staticmethod
    async def load_artifact_as_dict(
        ctx: InvocationContext, filename: str, version: Optional[int] = None
    ) -> Optional[dict]:
        """
        Load an artifact and parse as JSON dict.

        Args:
            ctx: Callback context with artifact service
            filename: Artifact filename
            version: Specific version (None = latest)

        Returns:
            Parsed dict or None if not found
        """
        try:
            artifact = await ctx.artifact_service.load_artifact(
                session_id=ctx.session.id,
                user_id=ctx.session.user_id,
                app_name=ctx.session.app_name,
                filename=filename,
                version=version,
            )

            if (
                artifact is None
                or not hasattr(artifact, "inline_data")
                or artifact.inline_data is None
            ):
                logger.warning(f"Artifact not found or invalid: {filename}")
                return None

            data = json.loads(artifact.inline_data.data.decode("utf-8"))
            logger.debug(f"Loaded artifact: {filename} v{version or 'latest'}")
            return data

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse artifact {filename}: {e}")
            return None
        except Exception as e:
            logger.error(f"Error loading artifact {filename}: {e}")
            return None

    @staticmethod
    async def load_artifact_as_string(
        ctx: InvocationContext, filename: str, version: Optional[int] = None
    ) -> Optional[str]:
        """
        Load an artifact as raw string.

        Args:
            ctx: Callback context with artifact service
            filename: Artifact filename
            version: Specific version (None = latest)

        Returns:
            Raw string content or None if not found
        """
        try:
            artifact = await ctx.artifact_service.load_artifact(
                session_id=ctx.session.id,
                user_id=ctx.session.user_id,
                app_name=ctx.session.app_name,
                filename=filename,
                version=version,
            )

            if (
                artifact is None
                or not hasattr(artifact, "inline_data")
                or artifact.inline_data is None
            ):
                logger.warning(f"Artifact not found or invalid: {filename}")
                return None

            return artifact.inline_data.data.decode("utf-8")

        except Exception as e:
            logger.error(f"Error loading artifact {filename}: {e}")
            return None

    @staticmethod
    async def save_config_artifact_from_invocation_context(
        ctx: InvocationContext, config: dict, filename: str
    ) -> int:
        """
        Save a config dict as artifact.

        Args:
            ctx: Callback context with artifact service
            config: Configuration dictionary
            filename: Artifact filename

        Returns:
            Version number of saved artifact
        """
        try:
            json_bytes = json.dumps(config, separators=(",", ":"), ensure_ascii=False).encode(
                "utf-8"
            )

            artifact = genai.types.Part.from_bytes(data=json_bytes, mime_type="text/plain")

            version = await ctx.artifact_service.save_artifact(
                session_id=ctx.session.id,
                user_id=ctx.session.user_id,
                app_name=ctx.session.app_name,
                filename=filename,
                artifact=artifact,
            )
            logger.info(f"Saved config artifact: {filename} v{version} ({len(json_bytes)} bytes)")
            return version

        except Exception as e:
            logger.error(f"Failed to save artifact {filename}: {e}")
            raise

    @staticmethod
    async def save_config_artifact(
        callback_context: CallbackContext, config: dict, filename: str
    ) -> int:
        """
        Save a config dict as artifact.

        Args:
            ctx: Callback context with artifact service
            config: Configuration dictionary
            filename: Artifact filename

        Returns:
            Version number of saved artifact
        """
        try:
            json_bytes = json.dumps(config, separators=(",", ":"), ensure_ascii=False).encode(
                "utf-8"
            )

            artifact = genai.types.Part.from_bytes(data=json_bytes, mime_type="application/json")

            version = await callback_context.save_artifact(filename=filename, artifact=artifact)
            logger.info(f"Saved config artifact: {filename} v{version} ({len(json_bytes)} bytes)")
            return version

        except Exception as e:
            logger.error(f"Failed to save artifact {filename}: {e}")
            raise

    @staticmethod
    async def save_page_artifact(
        ctx: CallbackContext, page_config: dict, page_identifier: str
    ) -> int:
        """
        Save a page config as artifact.

        Args:
            ctx: Callback context
            page_config: Page configuration dict
            page_identifier: Unique page identifier (e.g., "home", "about")

        Returns:
            Version number
        """
        filename = f"{PAGE_PREFIX}{page_identifier}.json"
        return await ArtifactManager.save_config_artifact(ctx, page_config, filename)

    @staticmethod
    async def save_webapp_artifact(
        ctx: CallbackContext, webapp_config: dict, name: str = "skeleton"
    ) -> int:
        """
        Save a webapp config as artifact.

        Args:
            ctx: Callback context
            webapp_config: WebApp configuration dict
            name: Artifact name (default: "skeleton")

        Returns:
            Version number
        """
        filename = f"{WEBAPP_PREFIX}{name}.json"
        return await ArtifactManager.save_config_artifact_from_invocation_context(
            ctx, webapp_config, filename
        )

    @staticmethod
    async def save_theme_artifact(ctx: CallbackContext, theme_config: dict) -> int:
        """
        Save a theme config as artifact.

        Args:
            ctx: Callback context
            theme_config: Theme configuration dict

        Returns:
            Version number
        """
        filename = f"{THEME_PREFIX}current.json"
        return await ArtifactManager.save_config_artifact(ctx, theme_config, filename)

    @staticmethod
    async def load_page_artifact(
        ctx: CallbackContext, page_identifier: str, version: Optional[int] = None
    ) -> Optional[dict]:
        """
        Load a page config from artifact.

        Args:
            ctx: Callback context
            page_identifier: Page identifier
            version: Specific version (None = latest)

        Returns:
            Page config dict or None
        """
        filename = f"{PAGE_PREFIX}{page_identifier}.json"
        return await ArtifactManager.load_artifact_as_dict(ctx, filename, version)

    @staticmethod
    async def load_webapp_artifact(
        ctx: CallbackContext, name: str = "skeleton", version: Optional[int] = None
    ) -> Optional[dict]:
        """
        Load a webapp config from artifact.

        Args:
            ctx: Callback context
            name: Artifact name
            version: Specific version (None = latest)

        Returns:
            WebApp config dict or None
        """
        filename = f"{WEBAPP_PREFIX}{name}.json"
        return await ArtifactManager.load_artifact_as_dict(ctx, filename, version)

    @staticmethod
    async def load_theme_artifact(
        ctx: CallbackContext, version: Optional[int] = None
    ) -> Optional[dict]:
        """
        Load theme config from artifact.

        Args:
            ctx: Callback context
            version: Specific version (None = latest)

        Returns:
            Theme config dict or None
        """
        filename = f"{THEME_PREFIX}current.json"
        return await ArtifactManager.load_artifact_as_dict(ctx, filename, version)

    @staticmethod
    async def list_artifacts(ctx: "CallbackContext | InvocationContext") -> list[str]:
        """
        List all artifact filenames in the session.

        Works for both ``CallbackContext`` (exposes ``list_artifacts``) and
        ``InvocationContext`` (does not — it only carries ``artifact_service``,
        so go through the service-level API). The validation service passes an
        InvocationContext here; calling ``ctx.list_artifacts()`` on it raised
        ``'InvocationContext' object has no attribute 'list_artifacts'`` every
        run, silently disabling artifact-diff capture.

        Args:
            ctx: Callback or invocation context

        Returns:
            List of artifact filenames (empty on any error)
        """
        try:
            list_fn = getattr(ctx, "list_artifacts", None)
            if callable(list_fn):
                return await list_fn()
            # InvocationContext path: list via the ArtifactService directly.
            artifact_service = getattr(ctx, "artifact_service", None)
            if artifact_service is None:
                return []
            return await artifact_service.list_artifact_keys(
                app_name=ctx.app_name,
                user_id=ctx.user_id,
                session_id=ctx.session.id,
            )
        except Exception as e:
            logger.error(f"Error listing artifacts: {e}")
            return []

    @staticmethod
    async def save_agent_io_artifact(
        ctx: InvocationContext, agent_name: str, io_type: str, data: Any
    ) -> None:
        """Save an agent's input or output as an artifact for debugging.

        Non-blocking: catches all exceptions and logs a warning.

        Args:
            ctx: Invocation context with artifact service
            agent_name: Agent name (e.g., "creator", "app_help_desk")
            io_type: "input" or "output"
            data: The data to save (dict, str, or any serializable object)
        """
        try:
            if data is None:
                return

            if isinstance(data, dict):
                text = json.dumps(data, indent=2, ensure_ascii=False)
            elif isinstance(data, str):
                text = data
            else:
                text = str(data)

            if not text:
                return

            filename = f"agent_io:{agent_name}:{io_type}.json"
            artifact = genai.types.Part.from_bytes(
                data=text.encode("utf-8"), mime_type="application/json"
            )
            await ctx.artifact_service.save_artifact(
                session_id=ctx.session.id,
                user_id=ctx.session.user_id,
                app_name=ctx.session.app_name,
                filename=filename,
                artifact=artifact,
            )
            logger.debug(f"Saved agent I/O artifact: {filename} ({len(text)} chars)")
        except Exception as e:
            logger.warning(f"Failed to save agent I/O artifact for {agent_name}/{io_type}: {e}")

    @staticmethod
    async def artifact_exists(ctx: CallbackContext, filename: str) -> bool:
        """
        Check if an artifact exists.

        Args:
            ctx: Callback context
            filename: Artifact filename

        Returns:
            True if artifact exists
        """
        artifacts = await ArtifactManager.list_artifacts(ctx)
        return filename in artifacts
