import unittest
from unittest.mock import AsyncMock, patch
from pydantic import ValidationError
from services import mail_recipient_groups as groups
from routers import google_workspace_browser as google
from routers import microsoft_workspace as microsoft


class RecipientGroupTests(unittest.IsolatedAsyncioTestCase):
    def test_normalizes_and_rejects_invalid_addresses(self):
        group = groups.RecipientGroup(id='one', name=' Team ', emails=['A@example.com', 'a@example.com'])
        self.assertEqual(group.name, 'Team')
        self.assertEqual(group.emails, ['a@example.com'])
        with self.assertRaises(ValidationError):
            groups.RecipientGroup(id='one', name='Team', emails=['not an email'])

    async def test_google_accounts_use_separate_documents(self):
        with patch.object(google, '_mail_signature_document_id', AsyncMock(side_effect=['google_mail_signature:A', 'google_mail_signature:B'])), patch.object(google, 'read_groups', AsyncMock(return_value={'groups': []})) as read:
            await google.get_recipient_groups('a')
            await google.get_recipient_groups('b')
        self.assertEqual([call.args[0] for call in read.call_args_list], ['google_recipient_groups:A', 'google_recipient_groups:B'])

    async def test_microsoft_accounts_use_separate_documents(self):
        with patch.object(microsoft.auth, 'account', AsyncMock()), patch.object(microsoft, 'read_groups', AsyncMock(return_value={'groups': []})) as read:
            await microsoft.get_recipient_groups('a')
            await microsoft.get_recipient_groups('b')
        self.assertEqual([call.args[0] for call in read.call_args_list], ['microsoft_recipient_groups:a', 'microsoft_recipient_groups:b'])

    async def test_save_and_read_round_trip_isolated(self):
        documents = {}
        es = AsyncMock()
        es.exists.side_effect = lambda index, id: id in documents
        es.get.side_effect = lambda index, id: {'_source': documents[id]}
        async def index_document(index, id, document, refresh):
            documents[id] = document
        es.index.side_effect = index_document
        request = groups.RecipientGroupsRequest(groups=[groups.RecipientGroup(id='1', name='Team', emails=['a@example.com'])])
        with patch.object(groups, 'get_es', return_value=es):
            await groups.save_groups('account-a', request)
            self.assertEqual(await groups.read_groups('account-a'), request.model_dump())
            self.assertEqual(await groups.read_groups('account-b'), {'groups': []})
            await groups.save_groups('account-a', groups.RecipientGroupsRequest())
            self.assertEqual(await groups.read_groups('account-a'), {'groups': []})
