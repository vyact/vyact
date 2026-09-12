import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from googleapiclient.errors import HttpError
from httplib2 import Response

from services import notification_polling as polling
from services.google_workspace.gmail import list_mail_messages_sync


class GoogleMailNotificationPollingTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.service = MagicMock()
        self.ids = [f'mail-{index}' for index in range(30)]
        self.read_ids = set()
        self.failed_ids = set()
        self.error_status = 403
        self.account = {'id': 'account', 'account_email': 'test@example.com'}
        self.service.users().messages().list.return_value.execute.side_effect = (
            lambda: {'messages': [{'id': message_id} for message_id in self.ids]}
        )

        def create_batch(callback):
            batch = MagicMock()
            requested_ids = []
            batch.add.side_effect = lambda request, request_id: requested_ids.append(request_id)

            def execute():
                for message_id in requested_ids:
                    if message_id in self.failed_ids:
                        callback(message_id, None, HttpError(
                            Response({'status': str(self.error_status)}),
                            b'{"error":{"message":"Request failed"}}',
                        ))
                    else:
                        callback(message_id, {
                            'id': message_id, 'internalDate': '1000',
                            'labelIds': ['INBOX'] + ([] if message_id in self.read_ids else ['UNREAD']),
                            'payload': {'headers': [
                                {'name': 'Subject', 'value': 'Subject'},
                                {'name': 'From', 'value': 'sender@example.com'},
                            ]},
                        }, None)

            batch.execute.side_effect = execute
            return batch

        self.service.new_batch_http_request.side_effect = create_batch
        self.create = AsyncMock(return_value=True)
        self.existing = AsyncMock(return_value=False)
        self.build = AsyncMock(return_value=self.service)
        for name, value in (
            ('_known_gmail_message_ids', {}), ('_gmail_initialized_accounts', set()),
            ('_build_service', self.build), ('has_notification_type', self.existing),
            ('create_notification', self.create),
        ):
            patcher = patch.object(polling, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    async def poll(self, account=None):
        await polling._collect_google_mail_notifications_for_account(account or self.account)

    async def test_initial_and_unchanged_poll_only_list_ids(self):
        await self.poll()
        await self.poll()
        self.assertEqual(self.service.users().messages().list.return_value.execute.call_count, 2)
        self.service.users().messages().get.assert_not_called()
        self.create.assert_not_awaited()
        self.assertEqual(polling.NOTIFICATION_COLLECTION_INTERVAL_SECONDS, 10)

    async def test_only_new_unread_message_notifies_with_original_metadata(self):
        await self.poll()
        self.ids = ['new', 'already-read', *self.ids[:28]]
        self.read_ids.add('already-read')
        await self.poll()
        await self.poll()
        self.assertEqual([call.kwargs['id'] for call in self.service.users().messages().get.call_args_list], ['new', 'already-read'])
        self.create.assert_awaited_once_with(
            notification_type='google_mail', source_id='new', title='Subject',
            message='sender@example.com', occurred_at='1970-01-01T00:00:01Z',
            account_id='account', account_email='test@example.com',
        )

    async def test_restart_with_history_checks_existing_unread_once(self):
        self.existing.return_value = True
        self.create.return_value = False  # Existing notification IDs are deduplicated in storage.
        await self.poll()
        await self.poll()
        self.assertEqual(self.service.users().messages().get.call_count, 30)
        self.assertEqual(self.create.await_count, 30)

    async def test_failed_detail_retried_next_poll_without_advancing_ids(self):
        await self.poll()
        self.ids.insert(0, 'new')
        self.failed_ids.add('new')
        with self.assertRaises(HttpError):
            await self.poll()
        self.assertNotIn('new', polling._known_gmail_message_ids['account'])
        self.failed_ids.clear()
        await self.poll()
        self.create.assert_awaited_once()
        self.assertEqual(self.service.users().messages().get.call_count, 2)

    async def test_deleted_message_does_not_block_other_new_mail(self):
        await self.poll()
        self.ids = ['deleted', 'new', *self.ids[:28]]
        self.failed_ids.add('deleted')
        self.error_status = 404
        await self.poll()
        self.create.assert_awaited_once()
        self.assertEqual(self.create.call_args.kwargs['source_id'], 'new')

    async def test_notification_save_failure_is_retried(self):
        await self.poll()
        self.ids.insert(0, 'new')
        self.create.side_effect = RuntimeError('storage unavailable')
        with self.assertRaises(RuntimeError):
            await self.poll()
        self.assertNotIn('new', polling._known_gmail_message_ids['account'])
        self.create.side_effect = None
        await self.poll()
        self.assertIn('new', polling._known_gmail_message_ids['account'])

    async def test_account_baselines_are_independent(self):
        await self.poll()
        self.ids = ['other-mail']
        await self.poll({'id': 'other', 'account_email': 'other@example.com'})
        self.assertEqual(polling._known_gmail_message_ids['other'], {'other-mail'})
        self.assertNotIn('other-mail', polling._known_gmail_message_ids['account'])
        self.create.assert_not_awaited()

    async def test_unauthorized_list_refreshes_token_once(self):
        error = HttpError(Response({'status': '401'}), b'{"error":{"message":"Unauthorized"}}')
        self.service.users().messages().list.return_value.execute.side_effect = [error, {'messages': []}]
        await self.poll()
        self.build.assert_awaited_with('gmail', 'v1', force_refresh=True, account_id='account')
        self.assertEqual(self.build.await_count, 2)

    def test_shared_message_list_still_loads_all_metadata(self):
        result = list_mail_messages_sync(self.service)
        self.assertEqual(len(result['messages']), 30)
        self.assertEqual(self.service.users().messages().get.call_count, 30)
