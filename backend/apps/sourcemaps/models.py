"""
Release artifacts for JavaScript source-map symbolication.

A **ReleaseArtifact** is one uploaded file (a minified bundle or its ``.map``)
associated with a project + release (+ optional ``dist``). At ingest time, JS
stack frames are resolved against these artifacts so the UI shows the original
file/line/column/function and source context instead of minified gibberish.

Artifacts are matched to a frame by ``name`` — the URL/path the file is served
at, e.g. ``~/static/app.min.js`` (``~`` means "any host"). The content is stored
in the row (text) so no external blob store is required; uploads are size-capped.
"""

from __future__ import annotations

import uuid

from django.db import models


class ReleaseArtifact(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    project = models.ForeignKey(
        "organizations.Project", on_delete=models.CASCADE, related_name="release_artifacts"
    )
    release = models.CharField(max_length=250, db_index=True)
    dist = models.CharField(max_length=64, blank=True)
    # The URL/abs_path the file is served at (``~`` = host-agnostic), or a map name.
    name = models.CharField(max_length=1024)
    # Optional headers, notably ``Sourcemap``/``SourceMap`` pointing at the .map.
    headers = models.JSONField(default=dict)
    # File body (UTF-8 text — JS source + source maps are text).
    content = models.TextField()
    size = models.PositiveIntegerField(default=0)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("project", "release", "dist", "name")]
        indexes = [
            models.Index(fields=["project", "release", "dist"]),
        ]
        ordering = ["name"]

    def __str__(self) -> str:
        return f"{self.release}/{self.name}"
