"""Unit tests for the SSRF outbound-fetch URL guard."""

import pytest

from main_agent.net import url_guard
from main_agent.net.url_guard import (
    UnsafeUrlError,
    assert_safe_url,
    is_blocked_ip,
)


class TestIsBlockedIp:
    @pytest.mark.parametrize(
        "ip",
        [
            "127.0.0.1",
            "169.254.169.254",  # cloud metadata (link-local)
            "10.0.0.5",
            "192.168.1.1",
            "172.16.0.1",
            "::1",
            "fc00::1",
            "0.0.0.0",
            "not-an-ip",  # fails closed
        ],
    )
    def test_blocks_internal_and_garbage(self, ip):
        assert is_blocked_ip(ip) is True

    @pytest.mark.parametrize("ip", ["8.8.8.8", "1.1.1.1"])
    def test_allows_public(self, ip):
        assert is_blocked_ip(ip) is False


class TestAssertSafeUrl:
    async def test_rejects_non_http_scheme(self):
        with pytest.raises(UnsafeUrlError):
            await assert_safe_url("ftp://example.com/x")

    # The IP-literal cases below stub _resolve to a PUBLIC address and assert it
    # is never called. Without that, they pass even when the literal fast path is
    # broken: a fall-through to resolution re-blocks the address anyway (real
    # getaddrinfo echoes a literal back), so the test would go green while the
    # explicit check was dead. Failing the resolver pins the rejection to the
    # literal branch itself.
    @pytest.fixture
    def resolver_must_not_run(self, monkeypatch):
        calls: list[str] = []

        async def fake_resolve(host):
            calls.append(host)
            return ["93.184.216.34"]  # public — would NOT be blocked

        monkeypatch.setattr(url_guard, "_resolve", fake_resolve)
        return calls

    async def test_rejects_ip_literal_loopback(self, resolver_must_not_run):
        with pytest.raises(UnsafeUrlError):
            await assert_safe_url("http://127.0.0.1/")
        assert resolver_must_not_run == [], "loopback literal must be rejected without DNS"

    async def test_rejects_metadata_ip(self, resolver_must_not_run):
        with pytest.raises(UnsafeUrlError):
            await assert_safe_url("http://169.254.169.254/latest/meta-data/")
        assert resolver_must_not_run == [], "metadata literal must be rejected without DNS"

    @pytest.mark.parametrize("url", ["http://10.0.0.5/", "http://192.168.1.1/", "http://[::1]/"])
    async def test_rejects_private_literals_without_dns(self, url, resolver_must_not_run):
        with pytest.raises(UnsafeUrlError):
            await assert_safe_url(url)
        assert resolver_must_not_run == []

    async def test_allows_public_ip_literal_without_dns(self, resolver_must_not_run):
        await assert_safe_url("http://93.184.216.34/x")
        assert resolver_must_not_run == []

    async def test_rejects_host_resolving_to_loopback(self, monkeypatch):
        async def fake_resolve(host):
            return ["127.0.0.1"]

        monkeypatch.setattr(url_guard, "_resolve", fake_resolve)
        with pytest.raises(UnsafeUrlError):
            await assert_safe_url("http://internal.example.com/")

    async def test_allows_public_host(self, monkeypatch):
        async def fake_resolve(host):
            return ["93.184.216.34"]  # example.com

        monkeypatch.setattr(url_guard, "_resolve", fake_resolve)
        # Should not raise.
        await assert_safe_url("https://example.com/asset.jpg")

    async def test_public_ip_literal_allowed(self):
        # No DNS needed for an IP literal.
        await assert_safe_url("https://8.8.8.8/")
