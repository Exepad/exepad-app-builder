"""Base service interface for all app types."""

from abc import ABC


class BaseService(ABC):
    """
    Abstract base class for app type services.

    Services encapsulate specific functionality (validation, generation, etc.)
    and can be shared across workflows or be app-type specific.
    """

    def __init__(self):
        """Initialize the service with any required dependencies."""
