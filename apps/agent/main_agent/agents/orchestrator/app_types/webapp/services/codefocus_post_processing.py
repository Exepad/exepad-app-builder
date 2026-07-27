"""
Post-Processing Service.

Delegates to the shared config_finalization utilities for UUID normalization
and timestamp updates. Unlike the webapp JSON post-processor, this service
doesn't need icon correction, navigation resolution, or scaffold processing
-- those are JSON-config-specific concerns.
"""

import structlog

from ...shared.services.config_finalization import fix_uuids, update_timestamp

logger = structlog.get_logger(__name__)


class PostProcessingService:
    """Simplified post-processing for app configs.

    Delegates to shared utilities in config_finalization.
    """

    def process(self, config: dict) -> dict:
        """Run all post-processing steps on the app config.

        Args:
            config: The assembled app_config dict

        Returns:
            Post-processed config dict
        """
        config = fix_uuids(config)
        config = update_timestamp(config)
        return config
