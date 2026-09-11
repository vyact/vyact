"""Account-scoped recipient groups, stored independently of mail signatures."""
import re

from pydantic import BaseModel, Field, field_validator

from services.db import GOOGLE_WORKSPACE_SETTINGS_INDEX, get_es


class RecipientGroup(BaseModel):
    id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=100)
    emails: list[str] = Field(min_length=1, max_length=500)

    @field_validator('name')
    @classmethod
    def normalize_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError('Group name is required')
        return value.strip()

    @field_validator('emails')
    @classmethod
    def normalize_emails(cls, values: list[str]) -> list[str]:
        emails = list(dict.fromkeys(value.strip().lower() for value in values))
        if any(not re.fullmatch(r'[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+', email) for email in emails):
            raise ValueError('Invalid email address')
        return emails


class RecipientGroupsRequest(BaseModel):
    groups: list[RecipientGroup] = Field(default_factory=list, max_length=100)

    @field_validator('groups')
    @classmethod
    def unique_groups(cls, groups: list[RecipientGroup]) -> list[RecipientGroup]:
        if len({group.id for group in groups}) != len(groups):
            raise ValueError('Duplicate group IDs')
        return groups


async def read_groups(key: str) -> dict:
    es = get_es()
    try:
        if not await es.exists(index=GOOGLE_WORKSPACE_SETTINGS_INDEX, id=key):
            return {'groups': []}
        return (await es.get(index=GOOGLE_WORKSPACE_SETTINGS_INDEX, id=key))['_source']['value']
    finally:
        await es.close()


async def save_groups(key: str, request: RecipientGroupsRequest) -> dict:
    es = get_es()
    value = request.model_dump()
    try:
        await es.index(index=GOOGLE_WORKSPACE_SETTINGS_INDEX, id=key, document={'key': key, 'value': value}, refresh=True)
        return value
    finally:
        await es.close()
