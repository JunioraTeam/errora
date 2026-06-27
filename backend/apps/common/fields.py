"""A TextField transparently encrypted at rest via Fernet."""

from __future__ import annotations

from django.db import models

from .crypto import decrypt, encrypt


class EncryptedTextField(models.TextField):
    """Stores ciphertext; returns plaintext to Python. Not searchable by value."""

    def from_db_value(self, value, expression, connection):
        if value is None:
            return value
        return decrypt(value)

    def get_prep_value(self, value):
        if value is None or value == "":
            return value
        return encrypt(str(value))
