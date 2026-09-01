import unittest

from fastapi.testclient import TestClient

from hermes_webrtc_poc.app import app


class AppCorsTests(unittest.TestCase):
    def test_trusted_g_origin_can_preflight_offer(self) -> None:
        response = TestClient(app).options(
            '/api/offer',
            headers={
                'Origin': 'http://127.0.0.1:5173',
                'Access-Control-Request-Method': 'POST',
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['access-control-allow-origin'], 'http://127.0.0.1:5173')
        self.assertIn('POST', response.headers['access-control-allow-methods'])

    def test_untrusted_origin_is_not_granted_offer_access(self) -> None:
        response = TestClient(app).options(
            '/api/offer',
            headers={
                'Origin': 'https://untrusted.example',
                'Access-Control-Request-Method': 'POST',
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertNotIn('access-control-allow-origin', response.headers)


if __name__ == '__main__':
    unittest.main()
