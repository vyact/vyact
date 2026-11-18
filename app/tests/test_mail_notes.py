import unittest
from unittest.mock import AsyncMock, patch

from pydantic import ValidationError
from services import mail_notes
from routers import google_workspace_browser as google
from routers import microsoft_workspace as microsoft


class MailNoteTests(unittest.IsolatedAsyncioTestCase):
    async def test_save_lookup_delete_and_account_isolation(self):
        documents = {}
        es = AsyncMock()
        es.exists.side_effect = lambda index, id: id in documents

        async def index_document(index, id, document, refresh):
            documents[id] = document

        async def delete_document(index, id, refresh):
            documents.pop(id)

        es.index.side_effect = index_document
        es.delete.side_effect = delete_document
        es.mget.side_effect = lambda index, ids: {'docs': [
            {'found': True, '_source': documents[id]} if id in documents else {'found': False}
            for id in ids
        ]}
        query = mail_notes.MailNotesQuery(ids=['mail/one', 'mail/two'])
        with patch.object(mail_notes, 'get_es', return_value=es):
            saved = await mail_notes.save_note('google:a', mail_notes.MailNoteRequest(id='mail/one', content=' link https://example.com '))
            self.assertEqual(saved['content'], 'link https://example.com')
            self.assertEqual((await mail_notes.read_notes('google:a', query))['notes'], {'mail/one': saved})
            self.assertEqual((await mail_notes.read_notes('google:b', query))['notes'], {})
            self.assertEqual((await mail_notes.read_notes('microsoft:a', query))['notes'], {})
            await mail_notes.save_note('google:a', mail_notes.MailNoteRequest(id='mail/one', content='  '))
            self.assertEqual((await mail_notes.read_notes('google:a', query))['notes'], {})
        self.assertEqual(es.close.await_count, 6)

    def test_request_limits(self):
        with self.assertRaises(ValidationError):
            mail_notes.MailNoteRequest(id='', content='x')
        with self.assertRaises(ValidationError):
            mail_notes.MailNoteRequest(id='one', content='x' * (mail_notes.MAX_NOTE_LENGTH + 1))
        with self.assertRaises(ValidationError):
            mail_notes.MailNotesQuery(ids=['one'] * 201)

    async def test_closes_connection_on_failure(self):
        es = AsyncMock()
        es.index.side_effect = RuntimeError('storage unavailable')
        with patch.object(mail_notes, 'get_es', return_value=es):
            with self.assertRaises(RuntimeError):
                await mail_notes.save_note('account', mail_notes.MailNoteRequest(id='one', content='note'))
        es.close.assert_awaited_once()

    async def test_routes_use_stable_account_identity(self):
        query = mail_notes.MailNotesQuery(ids=['one'])
        with patch('routers.google_workspace_browser._mail_signature_document_id', AsyncMock(return_value='google_mail_signature:email-hash')), patch('routers.google_workspace_browser.read_notes', AsyncMock(return_value={'notes': {}})) as read:
            await google.lookup_mail_notes('slot-a', query)
            read.assert_awaited_once_with('google_mail_signature:email-hash', query)
        with patch('routers.microsoft_workspace.auth.mail_settings_document_id', AsyncMock(return_value='microsoft_mail_signature:email-hash')) as identity, patch('routers.microsoft_workspace.read_notes', AsyncMock(return_value={'notes': {}})) as read:
            await microsoft.lookup_mail_notes('slot-a', query)
            identity.assert_awaited_once_with('slot-a', 'signature')
            read.assert_awaited_once_with('microsoft_mail_signature:email-hash', query)
