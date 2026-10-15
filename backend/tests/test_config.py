from aero.config import Settings, load_settings, save_settings, settings_from_dict


def test_defaults_and_unknown_keys():
    s = settings_from_dict({"depth_near_m": 2, "bogus": 1})
    assert s.depth_near_m == 2.0
    assert s.depth_far_m == Settings().depth_far_m


def test_roundtrip(tmp_path):
    p = tmp_path / "settings.json"
    assert load_settings(p) == Settings()
    save_settings(p, Settings(cd=0.7))
    assert load_settings(p).cd == 0.7
