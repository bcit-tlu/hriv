from app.component_versions import get_app_version


def test_get_app_version_from_env(monkeypatch) -> None:
    monkeypatch.setenv("APP_VERSION", " 1.2.3 ")
    assert get_app_version() == "1.2.3"


def test_get_app_version_defaults_to_unknown(monkeypatch) -> None:
    monkeypatch.delenv("APP_VERSION", raising=False)
    assert get_app_version() == "unknown"
    monkeypatch.setenv("APP_VERSION", "   ")
    assert get_app_version() == "unknown"
