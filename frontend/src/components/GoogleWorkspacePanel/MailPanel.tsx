import {memo, type ReactNode, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {renderAsync as renderDocx} from 'docx-preview';
import {createPortal} from 'react-dom';
import {useTranslation} from 'react-i18next';
import {Archive, CheckCircle2, ChevronDown, ChevronLeft, ChevronUp, CircleAlert, Clock3, Download, FileText, FolderInput, Forward, Inbox, LoaderCircle, Mail, MessageSquarePlus, MoreVertical, Paperclip, PenLine, Plus, RefreshCw, Reply, Save, Send, Settings, ShoppingBag, Sparkles, Star, Tag, Trash2, TriangleAlert, X} from 'lucide-react';
import {api} from '../../services/api';
import {ApiError} from '../../utils/apiError';
import {copyToClipboard} from '../../utils/helpers';
import {isSupportedChatFileName} from '../../utils/fileValidation';
import {toast} from '../common/ToastNotifications/ToastNotifications';
import signatureProfileCreative from '../../assets/email-signatures/profile-creative.png?inline';
import CustomSelect from '../CustomSelect/CustomSelect';
import ImageViewer from '../ImageViewer/ImageViewer';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import ConfirmModal from '../common/ConfirmModal/ConfirmModal';
import KnowledgeCollectionAttachSelect from '../KnowledgeCollectionsModal/KnowledgeCollectionAttachSelect';
import EmailEditor, {type EmailEditorHandle} from './EmailEditor';

type MailParticipant = MailAddress & {isMe: boolean};
type MailItem = {id: string; threadId?: string; labelIds?: string[]; from: string; participants?: MailParticipant[]; messageCount?: number; subject: string; date: string; snippet: string; isUnread: boolean; isStarred: boolean; hasAttachments?: boolean};
type MailAddress = {name: string; email: string};
type MailThreadMessage = {id: string; labelIds?: string[]; from: string; to: string; cc: string; bcc?: string; toAddresses?: MailAddress[]; ccAddresses?: MailAddress[]; bccAddresses?: MailAddress[]; subject: string; date: string; body: string; htmlBody?: string; attachments?: MailAttachment[]};
type MailDetail = {id: string; threadId?: string; labelIds?: string[]; from: string; to: MailAddress[]; cc: MailAddress[]; bcc: MailAddress[]; accountEmail: string; subject: string; date: string; body: string; htmlBody?: string; attachments: MailAttachment[]; threadMessages?: MailThreadMessage[]};
type MailAttachment = {id: string; filename: string; mimeType: string; size: number};
type MailLabel = {id: string; name: string; type: 'system' | 'user'; unreadCount: number};
type ComposeFields = {to: string[]; cc: string[]; bcc: string[]; subject: string; body: string};
type MailMacro = {id: string; title: string; content_html: string};
type RecentMailRecipient = {email: string; name: string; lastUsedAt: number; useCount: number};
type ForwardedAttachment = {messageId: string; id: string; filename: string; mimeType: string; size: number; forwarded: true};
type ComposeAttachment = File | ForwardedAttachment;
const isForwardedAttachment = (a: ComposeAttachment): a is ForwardedAttachment => 'forwarded' in a;

const MAX_MAIL_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_AI_CONTEXT_CHARS = 60_000;
const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PREVIEWABLE_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);
const RECENT_MAIL_RECIPIENTS_STORAGE_KEY = 'vyact-google-mail-recipients';
const MAX_RECENT_MAIL_RECIPIENTS = 100;
const EMAIL_BODY_INTERACTION_EVENT = 'vyact:email-body-interaction';

const PRIMARY_SYSTEM_LABEL_IDS = ['INBOX', 'STARRED', 'SNOOZED', 'SENT', 'DRAFT', 'CATEGORY_PURCHASES'];
const COLLAPSIBLE_SYSTEM_LABEL_IDS = ['IMPORTANT', 'SCHEDULED', 'SPAM', 'TRASH'];
const SYSTEM_LABELS = {
    INBOX: {icon: Inbox, nameKey: 'inbox'},
    STARRED: {icon: Star, nameKey: 'starred'},
    SNOOZED: {icon: Clock3, nameKey: 'snoozed'},
    SENT: {icon: Send, nameKey: 'sent'},
    DRAFT: {icon: FileText, nameKey: 'drafts'},
    CATEGORY_PURCHASES: {icon: ShoppingBag, nameKey: 'purchases'},
    IMPORTANT: {icon: Archive, nameKey: 'important'},
    SCHEDULED: {icon: Clock3, nameKey: 'scheduled'},
    ALL_MAIL: {icon: Mail, nameKey: 'allMail'},
    SPAM: {icon: TriangleAlert, nameKey: 'spam'},
    TRASH: {icon: Trash2, nameKey: 'trash'},
} as const;

const formatMailDate = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    const now = new Date();
    if (date.toDateString() === now.toDateString()) return new Intl.DateTimeFormat(undefined, {hour: 'numeric', minute: '2-digit'}).format(date);
    if (date.getFullYear() === now.getFullYear()) return new Intl.DateTimeFormat(undefined, {month: 'short', day: 'numeric'}).format(date);
    return new Intl.DateTimeFormat(undefined, {year: 'numeric', month: 'short', day: 'numeric'}).format(date);
};

const formatReceivedDate = (value: string, locale: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    }).format(date);
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character] ?? character));

const parseMailAddress = (value: string): MailAddress => {
    const matchedAddress = value.match(/^(.*?)\s*<([^>]+)>/);
    if (!matchedAddress) return {name: '', email: value.trim()};
    return {
        name: matchedAddress[1].trim().replace(/^["']|["']$/g, ''),
        email: matchedAddress[2].trim(),
    };
};

const getRecentMailRecipients = (accountId: string): RecentMailRecipient[] => {
    if (!accountId) return [];
    try {
        const storedRecipients = JSON.parse(localStorage.getItem(`${RECENT_MAIL_RECIPIENTS_STORAGE_KEY}:${accountId}`) || '[]');
        return Array.isArray(storedRecipients) ? storedRecipients : [];
    } catch {
        return [];
    }
};

const saveRecentMailRecipients = (accountId: string, addresses: MailAddress[], markAsUsed = false) => {
    if (!addresses.length) return getRecentMailRecipients(accountId);
    const recipientsByEmail = new Map(getRecentMailRecipients(accountId).map(recipient => [recipient.email.toLowerCase(), recipient]));
    addresses.forEach(address => {
        const email = address.email.trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
        const current = recipientsByEmail.get(email);
        recipientsByEmail.set(email, {
            email,
            name: address.name.trim() || current?.name || '',
            lastUsedAt: markAsUsed ? Date.now() : current?.lastUsedAt || 0,
            useCount: (current?.useCount || 0) + (markAsUsed ? 1 : 0),
        });
    });
    const recipients = [...recipientsByEmail.values()]
        .sort((first, second) => second.lastUsedAt - first.lastUsedAt || second.useCount - first.useCount || first.email.localeCompare(second.email))
        .slice(0, MAX_RECENT_MAIL_RECIPIENTS);
    try {
        localStorage.setItem(`${RECENT_MAIL_RECIPIENTS_STORAGE_KEY}:${accountId}`, JSON.stringify(recipients));
    } catch {
        // Autocomplete remains available for the current render.
    }
    return recipients;
};

const htmlToPlainText = (value: string) => {
    if (!/<[a-z][\s\S]*>/i.test(value)) return value;
    const document = new DOMParser().parseFromString(value, 'text/html');
    document.querySelectorAll('img').forEach(image => image.replaceWith(image.alt ? `[Image: ${image.alt}]` : '[Image]'));
    document.querySelectorAll('a[href]').forEach(link => {
        const href = link.getAttribute('href') || '';
        if (href && !link.textContent?.includes(href)) link.append(` (${href})`);
    });
    return document.body.innerText;
};

const normalizeVisibleEmailText = (value: string) => value
    .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '')
    .replace(/\u00A0/g, ' ')
    .trim();

const isVisibleEmailBodyImage = (image: HTMLImageElement) => {
    if (/\/readReceipt\/|[?&](?:tracking|track|pixel)=/i.test(image.src)) return false;
    if (image.hidden || image.getAttribute('aria-hidden') === 'true') return false;
    let element: HTMLElement | null = image;
    while (element) {
        const display = element.style.display.toLowerCase();
        const visibility = element.style.visibility.toLowerCase();
        if (display === 'none' || visibility === 'hidden' || element.style.opacity === '0') return false;
        element = element.parentElement;
    }
    const width = Number(image.getAttribute('width'));
    const height = Number(image.getAttribute('height'));
    return !((width > 0 && width <= 1) || (height > 0 && height <= 1));
};

const getVisibleEmailBodyText = (document: Document) => {
    const body = document.body.cloneNode(true) as HTMLElement;
    body.querySelectorAll('style, script, noscript, template, [hidden], [aria-hidden="true"]').forEach(element => element.remove());
    body.querySelectorAll<HTMLElement>('*').forEach(element => {
        if (
            element.style.display.toLowerCase() === 'none'
            || element.style.visibility.toLowerCase() === 'hidden'
            || element.style.opacity === '0'
        ) {
            element.remove();
        }
    });
    return normalizeVisibleEmailText(body.textContent || '');
};

const hasVisibleEmailContent = (mail: {body: string; htmlBody?: string}) => {
    if (mail.htmlBody) {
        const document = new DOMParser().parseFromString(mail.htmlBody, 'text/html');
        if (getVisibleEmailBodyText(document)) return true;
        return [...document.body.querySelectorAll('img')].some(isVisibleEmailBodyImage);
    }
    return Boolean(normalizeVisibleEmailText(htmlToPlainText(mail.body || '')));
};

const getAttachmentPreviewMimeType = (attachment: MailAttachment) => {
    const lowerName = attachment.filename.toLowerCase();
    if (attachment.mimeType === 'application/pdf' || lowerName.endsWith('.pdf')) return 'application/pdf';
    if (attachment.mimeType === DOCX_MIME_TYPE || lowerName.endsWith('.docx')) return DOCX_MIME_TYPE;
    if (attachment.mimeType.startsWith('image/')) return attachment.mimeType;
    const imageExtension = [...PREVIEWABLE_IMAGE_EXTENSIONS].find(extension => lowerName.endsWith(extension));
    if (!imageExtension) return null;
    const subtype = imageExtension === '.jpg' ? 'jpeg' : imageExtension.slice(1);
    return `image/${subtype}`;
};

const isSupportedChatMailAttachment = (attachment: MailAttachment) =>
    getAttachmentPreviewMimeType(attachment)?.startsWith('image/') === true
    || isSupportedChatFileName(attachment.filename);

const createImageFileFromDataUrl = async (dataUrl: string, filename: string) => {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const extension = blob.type.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
    return new File([blob], `${filename}.${extension}`, {type: blob.type});
};

const extractMailBodyImageFiles = async (messages: Array<{htmlBody?: string}>) => {
    const uniqueDataUrls = new Set<string>();
    messages.forEach(message => {
        if (!message.htmlBody) return;
        const document = new DOMParser().parseFromString(message.htmlBody, 'text/html');
        document.querySelectorAll<HTMLImageElement>('img[src^="data:image/"]').forEach(image => {
            uniqueDataUrls.add(image.src);
        });
    });
    return Promise.all([...uniqueDataUrls].map((dataUrl, index) =>
        createImageFileFromDataUrl(dataUrl, `email-inline-image-${index + 1}`),
    ));
};

const getMailThreadContext = (mail: MailDetail) => {
    const messages = mail.threadMessages?.length ? mail.threadMessages : [{
        id: mail.id,
        from: mail.from,
        to: mail.to.map(address => address.email).join(', '),
        cc: mail.cc.map(address => address.email).join(', '),
        subject: mail.subject,
        date: mail.date,
        body: mail.body,
    }];
    let remainingCharacters = MAX_AI_CONTEXT_CHARS;
    return messages.slice().reverse().map(message => {
        const plainBody = htmlToPlainText(message.body);
        const body = remainingCharacters > 0 ? plainBody.slice(-remainingCharacters) : '';
        remainingCharacters = Math.max(0, remainingCharacters - body.length);
        return {
            from_: message.from,
            to: message.to,
            cc: message.cc,
            subject: message.subject,
            date: message.date,
            body,
        };
    }).filter(message => message.body || remainingCharacters > 0).reverse();
};

const removeDarkModeStyles = (html: string) => html.replace(
    /@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*\{(?:[^{}]|\{[^{}]*\})*\}/gi,
    '',
);

const extractInlineImages = async (html: string) => {
    const document = new DOMParser().parseFromString(html, 'text/html');
    document.querySelectorAll<HTMLElement>('[data-mail-signature]').forEach(signature => {
        signature.style.fontFamily = 'Arial, Helvetica, sans-serif';
        signature.style.fontSize = '14px';
        signature.style.lineHeight = '1.6';
        signature.style.color = '#222222';
        signature.querySelectorAll<HTMLElement>('p').forEach(paragraph => {
            paragraph.style.margin = '0.3em 0';
            paragraph.style.lineHeight = '1.6';
        });
        signature.querySelectorAll<HTMLElement>('table, tbody, tr, td, th').forEach(element => {
            element.style.fontFamily = 'Arial, Helvetica, sans-serif';
            element.style.fontSize = '14px';
            element.style.lineHeight = '1.6';
        });
        const textNodes: Text[] = [];
        const walker = document.createTreeWalker(signature, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
        textNodes.forEach(textNode => {
            if (textNode.parentElement?.closest('a')) return;
            const parts = textNode.data.split(/([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/g);
            if (parts.length === 1) return;
            const fragment = document.createDocumentFragment();
            parts.forEach((part, index) => {
                if (index % 2 === 0) {
                    fragment.append(document.createTextNode(part));
                    return;
                }
                const link = document.createElement('a');
                link.href = `mailto:${part}`;
                link.textContent = part;
                link.style.color = 'inherit';
                link.style.textDecoration = 'none';
                fragment.append(link);
            });
            textNode.replaceWith(fragment);
        });
    });
    const images: File[] = [];
    const dataUrlImages = [...document.querySelectorAll<HTMLImageElement>('img[src^="data:image/"]')];
    await Promise.all(dataUrlImages.map(async (image, index) => {
        const contentId = `inline-image-${index + 1}`;
        images[index] = await createImageFileFromDataUrl(image.src, contentId);
        image.src = `cid:${contentId}`;
    }));
    return {html: document.body.innerHTML, images};
};

const MAIL_SIGNATURE_STYLE = 'margin-top: 24px; padding-top: 16px; border-top: 1px solid #d9d9d9; font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.6; color: #222222;';

const addMailSignature = (body: string, signature: string) => {
    if (!signature) return body;
    const editableBody = body || '<p></p>';
    return `${editableBody}<div data-mail-signature="true" style="${MAIL_SIGNATURE_STYLE}">${signature}</div>`;
};

const getMailBodyWithoutSignature = (html: string) => {
    const document = new DOMParser().parseFromString(html, 'text/html');
    document.querySelectorAll('[data-mail-signature]').forEach(signature => signature.remove());
    return document.body.innerHTML;
};

const getPlainTextFromHtml = (html: string) => {
    const document = new DOMParser().parseFromString(html, 'text/html');
    return document.body.textContent?.trim() || '';
};

const createEmailDocument = (body: string) => `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src http: https: data: blob: cid:; style-src 'unsafe-inline';"><base target="_blank"><meta name="viewport" content="width=device-width, initial-scale=1"><style>:root { color-scheme: light !important; } html, body { min-height: 100%; max-width: 100%; margin: 0; overflow-x: hidden; background: #fff; } body { box-sizing: border-box; padding: 24px; overflow-wrap: anywhere; word-break: break-word; font-family: Pretendard, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif; font-size: 14px; line-height: 1.5; } body * { box-sizing: border-box; max-width: 100%; } pre { white-space: pre-wrap; overflow-wrap: anywhere; } table { max-width: 100% !important; } td, th { overflow-wrap: normal; word-break: normal; } img { max-width: 100% !important; height: auto !important; }</style></head><body>${body}</body></html>`;

function DocxAttachmentPreview({file, label}: {file: Blob; label: string}) {
    const {t} = useTranslation('main');
    const containerRef = useRef<HTMLDivElement>(null);
    const [renderFailed, setRenderFailed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const renderDocument = async () => {
            const container = containerRef.current;
            if (!container) return;
            setRenderFailed(false);
            container.replaceChildren();
            try {
                await renderDocx(file, container, container, {
                    inWrapper: true,
                    ignoreWidth: false,
                    ignoreHeight: false,
                    breakPages: true,
                    renderHeaders: true,
                    renderFooters: true,
                    renderFootnotes: true,
                    useBase64URL: true,
                });
            } catch {
                if (!cancelled) setRenderFailed(true);
            }
        };
        void renderDocument();
        return () => {
            cancelled = true;
            containerRef.current?.replaceChildren();
        };
    }, [file]);

    return <div className="gwp-docx-preview-shell">
        <div ref={containerRef} className="gwp-docx-preview" role="document" aria-label={label}/>
        {renderFailed && <div className="gwp-docx-preview-error" role="alert">{t('googleWorkspace.docxPreviewError')}</div>}
    </div>;
}

const EmailBody = memo(function EmailBody({mail, fillAvailableSpace = false}: {
    mail: {body: string; htmlBody?: string};
    fillAvailableSpace?: boolean;
}) {
    const {t} = useTranslation('main');
    if (!hasVisibleEmailContent(mail)) {
        return <div className="gwp-email-empty" role="status">
            <Mail aria-hidden="true" size={28}/>
            <span>{t('googleWorkspace.noEmailContent')}</span>
        </div>;
    }
    return <iframe
        aria-label={t('googleWorkspace.emailContent')}
        className={`gwp-email-html${fillAvailableSpace ? ' gwp-email-html--fill' : ''}`}
        sandbox="allow-popups allow-same-origin"
        scrolling={fillAvailableSpace ? 'auto' : 'no'}
        srcDoc={createEmailDocument(removeDarkModeStyles(mail.htmlBody || `<pre>${escapeHtml(mail.body)}</pre>`))}
        onLoad={event => {
            const iframe = event.currentTarget;
            const resizeToContent = () => {
                if (fillAvailableSpace) return;
                const document = iframe.contentDocument;
                if (!document) return;
                iframe.style.height = `${Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)}px`;
            };
            resizeToContent();
            iframe.contentDocument?.querySelectorAll('img').forEach(image => {
                if (!image.complete) image.addEventListener('load', resizeToContent, {once: true});
            });
            iframe.contentDocument?.addEventListener('pointerdown', () => {
                window.dispatchEvent(new Event(EMAIL_BODY_INTERACTION_EVENT));
            });
            window.requestAnimationFrame(resizeToContent);
        }}
    />;
});

function MailRecipientField({name, label, recipients, suggestions, onChange, invalidEmailMessage, removeLabel, trailingAction}: {
    name: 'to' | 'cc' | 'bcc';
    label: string;
    recipients: string[];
    suggestions: RecentMailRecipient[];
    onChange: (recipients: string[]) => void;
    invalidEmailMessage: string;
    removeLabel: (email: string) => string;
    trailingAction?: ReactNode;
}) {
    const [draft, setDraft] = useState('');
    const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false);
    const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    const normalizedDraft = draft.trim().toLowerCase();
    const filteredSuggestions = suggestions
        .filter(suggestion => !recipients.includes(suggestion.email))
        .filter(suggestion => !normalizedDraft || suggestion.email.includes(normalizedDraft) || suggestion.name.toLowerCase().includes(normalizedDraft))
        .slice(0, 6);
    const addRecipients = (value = draft) => {
        const candidates = value.split(/[,;\s]+/).map(item => item.trim()).filter(Boolean);
        if (!candidates.length) return true;
        if (candidates.some(candidate => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate))) {
            inputRef.current?.setCustomValidity(invalidEmailMessage);
            inputRef.current?.reportValidity();
            return false;
        }
        onChange([...new Set([...recipients, ...candidates])]);
        setDraft('');
        inputRef.current?.setCustomValidity('');
        return true;
    };
    const selectSuggestion = (suggestion: RecentMailRecipient) => {
        onChange([...new Set([...recipients, suggestion.email])]);
        setDraft('');
        setIsSuggestionsOpen(false);
        setActiveSuggestionIndex(0);
        inputRef.current?.setCustomValidity('');
        inputRef.current?.focus();
    };

    return <div className="gwp-recipient-field">
        <span className="gwp-recipient-label">{label}</span>
        <div className="gwp-recipient-input-shell" onClick={() => inputRef.current?.focus()}>
            {recipients.map(recipient => <span className="gwp-recipient-chip" key={recipient}><span>{recipient}</span><button type="button" aria-label={removeLabel(recipient)} onClick={() => onChange(recipients.filter(item => item !== recipient))}>×</button></span>)}
            <input
                ref={inputRef}
                type="email"
                value={draft}
                aria-label={label}
                autoComplete="off"
                onFocus={() => setIsSuggestionsOpen(true)}
                onChange={event => {
                    event.currentTarget.setCustomValidity('');
                    setDraft(event.target.value);
                    setIsSuggestionsOpen(true);
                    setActiveSuggestionIndex(0);
                }}
                onBlur={() => {
                    setIsSuggestionsOpen(false);
                    void addRecipients();
                }}
                onKeyDown={event => {
                    if (event.key === 'Escape') {
                        event.preventDefault();
                        event.stopPropagation();
                        setIsSuggestionsOpen(false);
                    } else if (event.key === 'ArrowDown' && filteredSuggestions.length) {
                        event.preventDefault();
                        setIsSuggestionsOpen(true);
                        setActiveSuggestionIndex(index => (index + 1) % filteredSuggestions.length);
                    } else if (event.key === 'ArrowUp' && filteredSuggestions.length) {
                        event.preventDefault();
                        setActiveSuggestionIndex(index => (index - 1 + filteredSuggestions.length) % filteredSuggestions.length);
                    } else if (event.key === 'Enter' && filteredSuggestions[activeSuggestionIndex]) {
                        event.preventDefault();
                        selectSuggestion(filteredSuggestions[activeSuggestionIndex]);
                    } else if (event.key === 'Enter' || event.key === ',' || event.key === ';') {
                        event.preventDefault();
                        addRecipients();
                    } else if (event.key === 'Backspace' && !draft && recipients.length) {
                        onChange(recipients.slice(0, -1));
                    }
                }}
                onPaste={event => {
                    const pastedValue = event.clipboardData.getData('text');
                    if (!/[,;\s]/.test(pastedValue.trim())) return;
                    event.preventDefault();
                    addRecipients(pastedValue);
                }}
            />
            {trailingAction}
            {isSuggestionsOpen && filteredSuggestions.length > 0 && <div className="gwp-recipient-suggestions" role="listbox">
                {filteredSuggestions.map((suggestion, index) => <button
                    key={suggestion.email}
                    type="button"
                    role="option"
                    aria-selected={index === activeSuggestionIndex}
                    className={index === activeSuggestionIndex ? 'active' : ''}
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => selectSuggestion(suggestion)}
                >
                    <span>{suggestion.name || suggestion.email}</span>
                    {suggestion.name && <small>{suggestion.email}</small>}
                </button>)}
            </div>}
        </div>
        <input type="hidden" name={name} value={recipients.join(', ')}/>
    </div>;
}

function MailPanel({accountId, selectedMessageId, onAttachFilesToChat}: {
    accountId: string;
    selectedMessageId?: string | null;
    onAttachFilesToChat?: (files: File[]) => Promise<void> | void;
}) {
    const {t, i18n} = useTranslation('main');
    const [labels, setLabels] = useState<MailLabel[]>([]);
    const [label, setLabel] = useState('INBOX');
    const [showAllSystemLabels, setShowAllSystemLabels] = useState(false);
    const [isLabelCreateOpen, setIsLabelCreateOpen] = useState(false);
    const [newLabelName, setNewLabelName] = useState('');
    const [isCreatingLabel, setIsCreatingLabel] = useState(false);
    const [labelToDelete, setLabelToDelete] = useState<MailLabel | null>(null);
    const [isDeletingLabel, setIsDeletingLabel] = useState(false);
    const [mails, setMails] = useState<MailItem[]>([]);
    const [selectedMailIds, setSelectedMailIds] = useState<Set<string>>(new Set());
    const [nextMailPageToken, setNextMailPageToken] = useState<string | null>(null);
    const [mailLoading, setMailLoading] = useState(false);
    const [loadingMoreMails, setLoadingMoreMails] = useState(false);
    const [selected, setSelected] = useState<MailDetail | null>(null);
    const [selectedKnowledgeSourceId, setSelectedKnowledgeSourceId] = useState('');
    const [expandedThreadMessageIds, setExpandedThreadMessageIds] = useState<Set<string>>(new Set());
    const [compose, setCompose] = useState(false);
    const [composeMode, setComposeMode] = useState<'new' | 'reply' | 'forward'>('new');
    const [replyTo, setReplyTo] = useState<MailDetail | null>(null);
    const [attachments, setAttachments] = useState<ComposeAttachment[]>([]);
    const [composeFields, setComposeFields] = useState<ComposeFields>({to: [], cc: [], bcc: [], subject: '', body: ''});
    const [isCcVisible, setIsCcVisible] = useState(false);
    const [isBccVisible, setIsBccVisible] = useState(false);
    const [recipientSuggestions, setRecipientSuggestions] = useState<RecentMailRecipient[]>([]);
    const [isSending, setIsSending] = useState(false);
    const [isTrashingMails, setIsTrashingMails] = useState(false);
    const [isMovingMails, setIsMovingMails] = useState(false);
    const [isApplyingLabel, setIsApplyingLabel] = useState(false);
    const [moveMenuOpen, setMoveMenuOpen] = useState(false);
    const [labelApplyMenuOpen, setLabelApplyMenuOpen] = useState(false);
    const [updatingStarMailIds, setUpdatingStarMailIds] = useState<Set<string>>(new Set());
    const [isOpeningMail, setIsOpeningMail] = useState(false);
    const [isRefreshingSentReply, setIsRefreshingSentReply] = useState(false);
    const [isAttachingToChat, setIsAttachingToChat] = useState(false);
    const [mailChatAttachLabel, setMailChatAttachLabel] = useState('');
    const [mailAttachMenuId, setMailAttachMenuId] = useState<string | null>(null);
    const [mailAttachMenuOpensUpward, setMailAttachMenuOpensUpward] = useState(false);
    const [mailAttachmentOperation, setMailAttachmentOperation] = useState<{
        key: string;
        action: 'preview' | 'download';
        filename: string;
    } | null>(null);
    const [attachmentPreview, setAttachmentPreview] = useState<{filename: string; mimeType: string; url?: string; docx?: Blob} | null>(null);

    useEffect(() => {
        const threadId = selected?.threadId || selected?.id;
        if (!threadId || !accountId || !globalThis.crypto?.subtle) { setSelectedKnowledgeSourceId(''); return; }
        void globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${accountId}:${threadId}`)).then(buffer => {
            setSelectedKnowledgeSourceId(Array.from(new Uint8Array(buffer)).map(byte => byte.toString(16).padStart(2, '0')).join(''));
        });
    }, [accountId, selected?.id, selected?.threadId]);
    const [sendFeedback, setSendFeedback] = useState<'success' | 'error' | null>(null);
    const [mailSignature, setMailSignature] = useState('');
    const [signatureEnabled, setSignatureEnabled] = useState(true);
    const [signatureSettingsOpen, setSignatureSettingsOpen] = useState(false);
    const [settingsSection, setSettingsSection] = useState<'signature' | 'macros'>('signature');
    const [signatureEditing, setSignatureEditing] = useState(false);
    const [signatureDraft, setSignatureDraft] = useState('');
    const [selectedSignatureTemplate, setSelectedSignatureTemplate] = useState('');
    const [mailMacros, setMailMacros] = useState<MailMacro[]>([]);
    const [macroDraft, setMacroDraft] = useState<MailMacro | null>(null);
    const [macroToDelete, setMacroToDelete] = useState<MailMacro | null>(null);
    const [macroSaveContent, setMacroSaveContent] = useState('');
    const [macroSaveTitle, setMacroSaveTitle] = useState('');
    const [isMacroSaveOpen, setIsMacroSaveOpen] = useState(false);
    const [draggedMacroId, setDraggedMacroId] = useState<string | null>(null);
    const [dragOverMacroId, setDragOverMacroId] = useState<string | null>(null);
    const [selectedMacroId, setSelectedMacroId] = useState('');
    const [isMacroMenuOpen, setIsMacroMenuOpen] = useState(false);
    const macroMenuRef = useRef<HTMLDivElement>(null);
    const attachmentRef = useRef<HTMLInputElement>(null);
    const composeAttachmentDetailsRef = useRef<HTMLDetailsElement>(null);
    const mailOpenRequestIdRef = useRef(0);
    const [aiPromptOpen, setAiPromptOpen] = useState(false);
    const [aiPrompt, setAiPrompt] = useState('');

    useEffect(() => {
        if (!mailAttachMenuId) return;
        const closeAttachMenu = () => {
            setMailAttachMenuId(null);
            setMailAttachMenuOpensUpward(false);
        };
        document.addEventListener('click', closeAttachMenu);
        window.addEventListener(EMAIL_BODY_INTERACTION_EVENT, closeAttachMenu);
        return () => {
            document.removeEventListener('click', closeAttachMenu);
            window.removeEventListener(EMAIL_BODY_INTERACTION_EVENT, closeAttachMenu);
        };
    }, [mailAttachMenuId]);
    useEffect(() => {
        if (!isMacroMenuOpen) return;
        const closeMacroMenu = (event: PointerEvent) => {
            if (!macroMenuRef.current?.contains(event.target as Node)) setIsMacroMenuOpen(false);
        };
        document.addEventListener('pointerdown', closeMacroMenu);
        return () => document.removeEventListener('pointerdown', closeMacroMenu);
    }, [isMacroMenuOpen]);
    const [aiGenerating, setAiGenerating] = useState(false);
    const [aiGeneratedText, setAiGeneratedText] = useState<string | null>(null);
    const [originalMailForAi, setOriginalMailForAi] = useState<MailDetail | null>(null);
    const [originalHtmlBody, setOriginalHtmlBody] = useState<string>('');
    const emailEditorRef = useRef<EmailEditorHandle>(null);
    const signatureEditorRef = useRef<EmailEditorHandle>(null);
    const macroEditorRef = useRef<EmailEditorHandle>(null);

    useEffect(() => {
        let cancelled = false;
        setRecipientSuggestions(getRecentMailRecipients(accountId));
        setMailSignature('');
        setSignatureEnabled(true);
        setMailMacros([]);
        if (accountId) {
            void api.getGoogleMailSignature(accountId).then(result => {
                if (!cancelled) {
                    setMailSignature(result.signature_html || '');
                    setSignatureEnabled(result.enabled);
                    setMailMacros(Array.isArray(result.macros) ? result.macros : []);
                }
            }).catch(() => {
                if (!cancelled) {
                    setMailSignature('');
                    setSignatureEnabled(true);
                }
            });
        }
        return () => { cancelled = true; };
    }, [accountId]);
    const sendingRef = useRef(false);
    const trashingMailsRef = useRef(false);

    const loadMailLabels = async () => {
        const data = await api.getGoogleMailLabels();
        setLabels(data.labels || []);
    };
    const createMailLabel = async () => {
        const name = newLabelName.trim();
        if (!name || isCreatingLabel) return;
        setIsCreatingLabel(true);
        try {
            await api.createGoogleMailLabel(name);
            await loadMailLabels();
            setNewLabelName('');
            setIsLabelCreateOpen(false);
        } finally {
            setIsCreatingLabel(false);
        }
    };
    const deleteMailLabel = async () => {
        if (!labelToDelete || isDeletingLabel) return;
        const deletedLabelId = labelToDelete.id;
        setIsDeletingLabel(true);
        try {
            await api.deleteGoogleMailLabel(deletedLabelId);
            setLabels(current => current.filter(item => item.id !== deletedLabelId));
            if (label === deletedLabelId) {
                setSelected(null);
                setLabel('INBOX');
            }
            setLabelToDelete(null);
            await loadMailLabels();
        } finally {
            setIsDeletingLabel(false);
        }
    };

    const loadMails = async (pageToken = '') => {
        const isNextPage = Boolean(pageToken);
        if (isNextPage) setLoadingMoreMails(true); else setMailLoading(true);
        try {
            const result = isNextPage
                ? await api.getGoogleMailMessages(label, pageToken)
                : await api.getGoogleMailWorkspace(label);
            if (!isNextPage) setLabels(result.labels || []);
            const nextMails = result.messages || [];
            const discoveredRecipients = nextMails.flatMap((mail: MailItem) => {
                const participants = mail.participants?.filter((participant: MailParticipant) => !participant.isMe) || [];
                return participants.length
                    ? participants.map(({name, email}: MailParticipant) => ({name, email}))
                    : [parseMailAddress(mail.from)];
            });
            setRecipientSuggestions(saveRecentMailRecipients(accountId, discoveredRecipients));
            setMails(current => isNextPage ? [...current, ...nextMails] : nextMails);
            if (!isNextPage) setSelectedMailIds(new Set());
            setNextMailPageToken(result.nextPageToken || null);
        } finally {
            if (isNextPage) setLoadingMoreMails(false); else setMailLoading(false);
        }
    };

    useEffect(() => {
        setMails([]);
        setSelected(null);
        setNextMailPageToken(null);
        if (accountId) void loadMails();
    }, [accountId, label]);
    useEffect(() => {
        if (!selectedMessageId) return;
        setLabel('INBOX');
        openMail(selectedMessageId);
    }, [selectedMessageId]);

    const openMail = async (id: string, showActivity = true) => {
        const requestId = ++mailOpenRequestIdRef.current;
        if (showActivity) setIsOpeningMail(true);
        try {
            const message = await api.getGoogleMailMessage(id);
            if (requestId !== mailOpenRequestIdRef.current) return;
            setSelected(message);
            const messageRecipients = [
                parseMailAddress(message.from),
                ...message.to,
                ...message.cc,
                ...message.bcc,
            ].filter(address => address.email.toLowerCase() !== message.accountEmail?.toLowerCase());
            setRecipientSuggestions(saveRecentMailRecipients(accountId, messageRecipients));
            const threadMessages = message.threadMessages || [];
            setExpandedThreadMessageIds(new Set([
                threadMessages.at(-1)?.id || message.id,
            ]));
            setMails(current => current.map(mail => mail.id === id ? {...mail, isUnread: false} : mail));
            void api.markGoogleMailMessageRead(id).then(loadMailLabels);
        } catch (error) {
            if (requestId !== mailOpenRequestIdRef.current) return;
            if (!(error instanceof ApiError && error.status === 404)) throw error;
        } finally {
            if (showActivity && requestId === mailOpenRequestIdRef.current) setIsOpeningMail(false);
        }
    };
    const closeCompose = () => {
        setCompose(false);
        setReplyTo(null);
        setAttachments([]);
        setComposeFields({to: [], cc: [], bcc: [], subject: '', body: ''});
        setIsCcVisible(false);
        setIsBccVisible(false);
        setIsMacroMenuOpen(false);
        if (attachmentRef.current) attachmentRef.current.value = '';
        setAiPromptOpen(false);
        setAiPrompt('');
        setAiGeneratedText(null);
        setOriginalMailForAi(null);
        setOriginalHtmlBody('');
    };
    const getAiPlaceholder = () => {
        if (composeMode === 'reply') return t('googleWorkspace.aiPlaceholderReply');
        if (composeMode === 'forward') return t('googleWorkspace.aiPlaceholderForward');
        return t('googleWorkspace.aiPromptPlaceholder');
    };
    const generateAiBody = async () => {
        if (!aiPrompt.trim() || aiGenerating || isSending || sendingRef.current) return;
        setAiGenerating(true);
        try {
            const originalMail = composeMode !== 'new' ? originalMailForAi : null;
            const attachmentContext = attachments.map(attachment => {
                const name = isForwardedAttachment(attachment) ? attachment.filename : attachment.name;
                const type = isForwardedAttachment(attachment) ? attachment.mimeType : attachment.type;
                return {name, mime_type: type, size: attachment.size};
            });
            const currentEditorHtml = emailEditorRef.current?.getHTML() || composeFields.body;
            const currentDraft = getPlainTextFromHtml(getMailBodyWithoutSignature(currentEditorHtml));
            const result = await api.generateGoogleMailBody({
                mode: composeMode,
                instruction: aiPrompt.trim(),
                current_message: {
                    to: composeFields.to,
                    cc: composeFields.cc,
                    bcc: composeFields.bcc,
                    subject: composeFields.subject,
                    draft: currentDraft,
                },
                attachments: attachmentContext,
                thread_messages: originalMail ? getMailThreadContext(originalMail) : [],
            });
            const generated = result.body.trim();
            setAiGeneratedText(generated);
        } catch {
            /* silently fail */
        } finally {
            setAiGenerating(false);
        }
    };
    const insertAiGeneratedBody = () => {
        if (!aiGeneratedText) return;
        const htmlContent = `<p>${escapeHtml(aiGeneratedText).split('\n\n').join('</p><p>').split('\n').join('<br>')}</p>`;
        const nextBody = addMailSignature(htmlContent, signatureEnabled ? mailSignature : '');
        setComposeFields(current => ({...current, body: nextBody}));
        emailEditorRef.current?.setContent(nextBody);
        setAiPromptOpen(false);
        setAiGeneratedText(null);
    };
    const addAttachments = (selectedFiles: FileList | null) => {
        if (!selectedFiles?.length || isSending || sendingRef.current) return;
        const filesToAdd = Array.from(selectedFiles);
        setAttachments(current => [...current, ...filesToAdd]);
        if (attachmentRef.current) attachmentRef.current.value = '';
    };
    const removeAttachment = (index: number) => setAttachments(current => current.filter((_, fileIndex) => fileIndex !== index));
    useEffect(() => {
        if (!compose) return;
        const closeAttachmentList = (event: PointerEvent) => {
            const details = composeAttachmentDetailsRef.current;
            if (details?.open && !details.contains(event.target as Node)) details.removeAttribute('open');
        };
        document.addEventListener('pointerdown', closeAttachmentList);
        return () => document.removeEventListener('pointerdown', closeAttachmentList);
    }, [compose]);
    useEffect(() => {
        if (!sendFeedback) return;
        const timeoutId = window.setTimeout(() => setSendFeedback(null), 3500);
        return () => window.clearTimeout(timeoutId);
    }, [sendFeedback]);

    const send = async (form: HTMLFormElement) => {
        if (sendingRef.current || aiGenerating) return;
        sendingRef.current = true;
        setIsSending(true);
        try {
            const data = new FormData(form);
            const resolvedFiles = await Promise.all(attachments.map(async (att) => {
                if (isForwardedAttachment(att)) {
                    const blob = await api.getGoogleMailAttachment(att.messageId, att.id, att.mimeType);
                    return new File([blob], att.filename, {type: att.mimeType});
                }
                return att;
            }));
            resolvedFiles.forEach(file => data.append('attachments', file));
            const editorHtml = emailEditorRef.current?.getHTML() || '';
            const hasEditorContent = editorHtml.replace(/<p><\/p>/g, '').trim().length > 0;
            let htmlBody = '';
            if (originalHtmlBody) {
                const userHtml = hasEditorContent ? editorHtml + '<br>' : '';
                htmlBody = userHtml + originalHtmlBody;
                if (!hasEditorContent && originalMailForAi) {
                    data.set('body', originalMailForAi.body || '');
                } else {
                    data.set('body', emailEditorRef.current?.editor?.getText() || '');
                }
            } else if (hasEditorContent) {
                htmlBody = editorHtml;
                data.set('body', emailEditorRef.current?.editor?.getText() || '');
            }
            if (htmlBody) {
                const extractedInlineImages = await extractInlineImages(htmlBody);
                data.set('html_body', extractedInlineImages.html);
                extractedInlineImages.images.forEach(image => data.append('inline_images', image));
            }
            const sentMessage = await api.sendGoogleMail(data);
            setRecipientSuggestions(saveRecentMailRecipients(
                accountId,
                [...composeFields.to, ...composeFields.cc, ...composeFields.bcc].map(email => ({name: '', email})),
                true,
            ));
            const threadRefreshMessageId = composeMode === 'reply'
                ? sentMessage.id || replyTo?.id
                : null;
            closeCompose();
            if (threadRefreshMessageId) {
                setIsRefreshingSentReply(true);
            } else {
                setSendFeedback('success');
            }
            const refreshRequests: Promise<unknown>[] = [loadMails()];
            if (threadRefreshMessageId) {
                refreshRequests.push(openMail(threadRefreshMessageId, false));
            }
            await Promise.allSettled(refreshRequests);
            if (threadRefreshMessageId) {
                setIsRefreshingSentReply(false);
            }
        } catch {
            setIsRefreshingSentReply(false);
            setSendFeedback('error');
        } finally {
            sendingRef.current = false;
            setIsSending(false);
        }
    };
    const selectLabel = (labelId: string) => {
        mailOpenRequestIdRef.current += 1;
        closeAttachmentPreview();
        setSelected(null);
        setExpandedThreadMessageIds(new Set());
        setMailAttachMenuId(null);
        setMoveMenuOpen(false);
        setLabelApplyMenuOpen(false);
        if (labelId === label) {
            void loadMails();
            return;
        }
        setLabel(labelId);
    };
    const refreshMails = () => loadMails();
    const deleteGoogleMailMessages = (messageIds: string[]) => label === 'TRASH'
        ? api.permanentlyDeleteGoogleMailMessages(messageIds)
        : api.trashGoogleMailMessages(messageIds);
    const deleteGoogleMailThreads = (threadIds: string[]) => label === 'TRASH'
        ? api.permanentlyDeleteGoogleMailThreads(threadIds)
        : api.trashGoogleMailThreads(threadIds);
    const showMailDeleteError = (error: unknown) => {
        const message = error instanceof ApiError && error.status === 403 && label === 'TRASH'
            ? t('googleWorkspace.permanentMailDeleteReconnectRequired')
            : error instanceof ApiError
                ? error.detail || error.message
            : error instanceof Error
                ? error.message
                : t('googleWorkspace.mailDeleteFailed');
        toast.error(message);
    };
    const toggleMailSelection = (mailId: string) => setSelectedMailIds(current => {
        const next = new Set(current);
        if (next.has(mailId)) next.delete(mailId); else next.add(mailId);
        return next;
    });
    const toggleAllMailSelection = () => setSelectedMailIds(current => current.size === mails.length ? new Set() : new Set(mails.map(mail => mail.id)));
    const toggleMailStar = async (mail: MailItem) => {
        if (updatingStarMailIds.has(mail.id)) return;
        const nextStarred = !mail.isStarred;
        setUpdatingStarMailIds(current => new Set(current).add(mail.id));
        setMails(current => current.map(item => item.id === mail.id ? {...item, isStarred: nextStarred} : item));
        try {
            await api.setGoogleMailMessageStarred(mail.id, nextStarred);
            if (label === 'STARRED' && !nextStarred) {
                setMails(current => current.filter(item => item.id !== mail.id));
                setSelectedMailIds(current => {
                    const next = new Set(current);
                    next.delete(mail.id);
                    return next;
                });
            }
        } catch {
            setMails(current => current.map(item => item.id === mail.id ? {...item, isStarred: mail.isStarred} : item));
        } finally {
            setUpdatingStarMailIds(current => {
                const next = new Set(current);
                next.delete(mail.id);
                return next;
            });
        }
    };
    const trashSelectedMails = async () => {
        if (!selectedMailIds.size || trashingMailsRef.current) return;
        const threadIds = mails
            .filter(mail => selectedMailIds.has(mail.id))
            .map(mail => mail.threadId || mail.id);
        if (!threadIds.length) return;
        trashingMailsRef.current = true;
        setIsTrashingMails(true);
        try {
            const uniqueThreadIds = [...new Set(threadIds)];
            await deleteGoogleMailThreads(uniqueThreadIds);
            setSelectedMailIds(new Set());
            await loadMails();
        } catch (error) {
            showMailDeleteError(error);
        } finally {
            trashingMailsRef.current = false;
            setIsTrashingMails(false);
        }
    };
    const moveSelectedMails = async (targetLabelId: string) => {
        if (!selectedMailIds.size || isMovingMails) return;
        const selectedThreads = mails
            .filter(mail => selectedMailIds.has(mail.id))
            .map(mail => mail.threadId || mail.id);
        setMoveMenuOpen(false);
        setIsMovingMails(true);
        try {
            await api.moveGoogleMailThreads(selectedThreads, targetLabelId, label, labels.some(item => item.type === 'user' && item.id === label));
            setSelectedMailIds(new Set());
            await loadMails();
        } finally {
            setIsMovingMails(false);
        }
    };
    const applyLabelToSelectedMails = async (targetLabelId: string) => {
        if (!selectedMailIds.size || isApplyingLabel) return;
        const selectedThreads = mails
            .filter(mail => selectedMailIds.has(mail.id))
            .map(mail => mail.threadId || mail.id);
        if (!selectedThreads.length) return;
        setLabelApplyMenuOpen(false);
        setIsApplyingLabel(true);
        try {
            await api.applyGoogleMailThreadLabel([...new Set(selectedThreads)], targetLabelId);
            setSelectedMailIds(new Set());
            await loadMails();
        } finally {
            setIsApplyingLabel(false);
        }
    };
    const trashSelectedThread = async () => {
        if (!selected || trashingMailsRef.current) return;
        const threadMessageIds = selected.threadMessages?.map(message => message.id) || [];
        const messageIds = [...new Set(threadMessageIds.length ? threadMessageIds : [selected.id])];
        trashingMailsRef.current = true;
        setIsTrashingMails(true);
        try {
            await deleteGoogleMailMessages(messageIds);
            setSelected(null);
            setSelectedMailIds(current => {
                const next = new Set(current);
                messageIds.forEach(messageId => next.delete(messageId));
                return next;
            });
            await loadMails();
        } catch (error) {
            showMailDeleteError(error);
        } finally {
            trashingMailsRef.current = false;
            setIsTrashingMails(false);
        }
    };
    const trashThreadMessage = async (messageId: string) => {
        if (!selected || trashingMailsRef.current) return;
        const remainingThreadMessages = selected.threadMessages?.filter(message => message.id !== messageId) || [];
        const remainingMessageId = remainingThreadMessages[0]?.id;
        const hasMessageInCurrentLabel = remainingThreadMessages.some(message => {
            if (!message.labelIds) return true;
            if (label === 'ALL_MAIL') {
                return !message.labelIds.includes('TRASH') && !message.labelIds.includes('SPAM');
            }
            return message.labelIds.includes(label);
        });
        trashingMailsRef.current = true;
        setIsTrashingMails(true);
        try {
            await deleteGoogleMailMessages([messageId]);
            if (remainingMessageId && hasMessageInCurrentLabel) {
                setSelected(current => current ? {
                    ...current,
                    id: current.id === messageId ? remainingMessageId : current.id,
                    threadMessages: remainingThreadMessages,
                } : current);
                setExpandedThreadMessageIds(current => {
                    const next = new Set(current);
                    next.delete(messageId);
                    return next;
                });
                await Promise.allSettled([openMail(remainingMessageId, false), loadMails()]);
            } else {
                setSelected(null);
                await loadMails();
            }
        } catch (error) {
            showMailDeleteError(error);
        } finally {
            trashingMailsRef.current = false;
            setIsTrashingMails(false);
        }
    };
    const openNewCompose = () => {
        setReplyTo(null);
        setAttachments([]);
        setComposeMode('new');
        setOriginalMailForAi(null);
        setOriginalHtmlBody('');
        setComposeFields({to: [], cc: [], bcc: [], subject: '', body: addMailSignature('', signatureEnabled ? mailSignature : '')});
        setIsCcVisible(false);
        setIsBccVisible(false);
        setIsMacroMenuOpen(false);
        setCompose(true);
    };
    const openSignatureSettings = () => {
        setSettingsSection('signature');
        setSignatureDraft(mailSignature);
        setSelectedSignatureTemplate('');
        setSignatureEditing(false);
        setSignatureSettingsOpen(true);
    };
    const toggleMailSignature = async () => {
        const enabled = !signatureEnabled;
        setSignatureEnabled(enabled);
        if (!accountId) return;
        try {
            await api.saveGoogleMailSignature(accountId, mailSignature, enabled, mailMacros);
        } catch {
            setSignatureEnabled(!enabled);
        }
    };
    const applySignatureTemplate = (templateId: string) => {
        setSelectedSignatureTemplate(templateId);
        if (!templateId) return;
        const name = escapeHtml(t('googleWorkspace.signatureTemplateName'));
        const role = escapeHtml(t('googleWorkspace.signatureTemplateRole'));
        const email = escapeHtml(t('googleWorkspace.signatureTemplateEmail'));
        const phone = escapeHtml(t('googleWorkspace.signatureTemplatePhone'));
        const website = escapeHtml(t('googleWorkspace.signatureTemplateWebsite'));
        const greeting = escapeHtml(t('googleWorkspace.signatureTemplateGreeting'));
        const templates: Record<string, string> = {
            business: `<div data-signature-layout><img src="${signatureProfileCreative}" alt="${name}" width="112" style="width: 112px; height: 112px; object-fit: cover; border-radius: 999px; display: block;"><p><strong><span style="color: #cc785c">${name}</span></strong><br>${role}</p><p>${email}<br>${phone}<br><span style="color: #cc785c">${website}</span></p></div>`,
            compact: `<p><strong>${name}</strong> · ${role}<br>${email} · ${phone}</p>`,
            minimal: `<p>${greeting}</p><p><strong>${name}</strong><br>${role}<br>${email}</p>`,
            classic: `<p><strong>${name}</strong><br>${role}<br>${email} · ${phone}<br>${website}</p>`,
        };
        const template = templates[templateId];
        if (!template) return;
        setSignatureDraft(template);
        signatureEditorRef.current?.setContent(template);
    };
    const saveMailSignature = async () => {
        const editorHtml = signatureEditorRef.current?.getHTML() || signatureDraft;
        const normalizedSignature = editorHtml.replace(/<p><\/p>/g, '').trim() ? editorHtml : '';
        if (!accountId) return;
        await api.saveGoogleMailSignature(accountId, normalizedSignature, signatureEnabled, mailMacros);
        setMailSignature(normalizedSignature);
        setSignatureEditing(false);
    };
    const saveMailMacros = async (macros: MailMacro[]) => {
        if (!accountId) return;
        await api.saveGoogleMailSignature(accountId, mailSignature, signatureEnabled, macros);
        setMailMacros(macros);
    };
    const openMacroSaveDialog = () => {
        const content = getMailBodyWithoutSignature(emailEditorRef.current?.getHTML() || composeFields.body);
        if (!getPlainTextFromHtml(content).trim()) return;
        setMacroSaveContent(content);
        setMacroSaveTitle('');
        setIsMacroSaveOpen(true);
    };
    const saveCurrentBodyAsMacro = async () => {
        const title = macroSaveTitle.trim();
        if (!title || !macroSaveContent) return;
        await saveMailMacros([...mailMacros, {id: crypto.randomUUID(), title, content_html: macroSaveContent}]);
        setIsMacroSaveOpen(false);
        setMacroSaveContent('');
    };
    const saveMacroDraft = async () => {
        if (!macroDraft?.title.trim()) return;
        const contentHtml = macroDraft.content_html.replace(/<p><\/p>/g, '').trim() ? macroDraft.content_html : '';
        const macro = {...macroDraft, title: macroDraft.title.trim(), content_html: contentHtml};
        const macros = mailMacros.some(item => item.id === macro.id)
            ? mailMacros.map(item => item.id === macro.id ? macro : item)
            : [...mailMacros, macro];
        await saveMailMacros(macros);
        setMacroDraft(null);
    };
    const deleteMailMacro = async (macroId: string) => {
        await saveMailMacros(mailMacros.filter(item => item.id !== macroId));
        if (macroDraft?.id === macroId) setMacroDraft(null);
    };
    const reorderMailMacros = async (targetMacroId: string) => {
        if (!draggedMacroId || draggedMacroId === targetMacroId) return;
        const sourceIndex = mailMacros.findIndex(macro => macro.id === draggedMacroId);
        const targetIndex = mailMacros.findIndex(macro => macro.id === targetMacroId);
        if (sourceIndex < 0 || targetIndex < 0) return;
        const macros = [...mailMacros];
        const [movedMacro] = macros.splice(sourceIndex, 1);
        macros.splice(targetIndex, 0, movedMacro);
        setMailMacros(macros);
        try {
            if (!accountId) return;
            await api.saveGoogleMailSignature(accountId, mailSignature, signatureEnabled, macros);
        } catch {
            setMailMacros(mailMacros);
        } finally {
            setDraggedMacroId(null);
            setDragOverMacroId(null);
        }
    };
    const applyMailMacro = (macroId: string) => {
        setSelectedMacroId('');
        const macro = mailMacros.find(item => item.id === macroId);
        if (!macro) return;
        const currentBody = emailEditorRef.current?.getHTML() || composeFields.body;
        const signatureIndex = currentBody.indexOf('<div data-mail-signature');
        const signature = signatureIndex >= 0 ? currentBody.slice(signatureIndex) : '';
        const nextBody = `${macro.content_html}${signature}`;
        setComposeFields(current => ({...current, body: nextBody}));
        emailEditorRef.current?.setContent(nextBody);
    };
    const buildQuotedHtml = (mail: MailDetail): string => {
        const date = new Date(mail.date);
        const formatted = date.toLocaleString(i18n.resolvedLanguage || i18n.language, {year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit'});
        const header = `<div style="color:#888;font-size:13px;margin-bottom:8px;">${escapeHtml(t('googleWorkspace.quotedHeader', {date: formatted, sender: mail.from}))}</div>`;
        const content = mail.htmlBody || `<pre style="white-space:pre-wrap;">${escapeHtml(mail.body)}</pre>`;
        return `${header}<blockquote style="margin:0 0 0 8px;padding:0 0 0 12px;border-left:3px solid #ccc;">${content}</blockquote>`;
    };
    const buildForwardHtml = (mail: MailDetail): string => {
        const date = new Date(mail.date);
        const formatted = date.toLocaleString(i18n.resolvedLanguage || i18n.language, {year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', hour: 'numeric', minute: '2-digit'});
        const toList = mail.to.map(a => a.name ? `${escapeHtml(a.name)} &lt;${escapeHtml(a.email)}&gt;` : `&lt;${escapeHtml(a.email)}&gt;`).join(', ');
        const ccList = mail.cc.map(a => a.name ? `${escapeHtml(a.name)} &lt;${escapeHtml(a.email)}&gt;` : `&lt;${escapeHtml(a.email)}&gt;`).join(', ');
        const content = mail.htmlBody || `<pre style="white-space:pre-wrap;">${escapeHtml(mail.body)}</pre>`;
        let header = `<div style="color:#888;font-size:13px;margin-bottom:12px;">---------- ${t('googleWorkspace.forwardedMessage')} ---------<br>${t('googleWorkspace.sender')}: ${escapeHtml(mail.from)}<br>${t('googleWorkspace.date')}: ${escapeHtml(formatted)}<br>${t('googleWorkspace.subject')}: ${escapeHtml(mail.subject || '')}<br>${t('googleWorkspace.recipient')}: ${toList}`;
        if (ccList) header += `<br>Cc: ${ccList}`;
        header += `</div>`;
        return `${header}${content}`;
    };
    const replyToMail = (mail: MailDetail) => {
        const senderEmail = mail.from.match(/<([^>]+)>/)?.[1] || mail.from;
        const myEmail = mail.accountEmail?.toLowerCase() || '';
        const senderIsMe = senderEmail.toLowerCase() === myEmail;
        const replyRecipients = senderIsMe
            ? mail.to.map(address => address.email).filter(email => email.toLowerCase() !== myEmail)
            : senderEmail ? [senderEmail] : [];
        const ccEmails = mail.cc
            .map(a => a.email)
            .filter(e => e.toLowerCase() !== myEmail && e.toLowerCase() !== senderEmail.toLowerCase());
        setAttachments([]);
        setReplyTo(mail);
        setComposeMode('reply');
        setOriginalMailForAi(mail);
        setOriginalHtmlBody(buildQuotedHtml(mail));
        setComposeFields({
            to: replyRecipients,
            cc: ccEmails,
            bcc: [],
            subject: `Re: ${mail.subject.replace(/^re:\s*/i, '') || ''}`,
            body: addMailSignature('', signatureEnabled ? mailSignature : ''),
        });
        setIsCcVisible(ccEmails.length > 0);
        setIsBccVisible(false);
        setIsMacroMenuOpen(false);
        setCompose(true);
    };
    const replyToSelectedMail = () => {
        if (selected) replyToMail(selected);
    };
    const forwardMail = (mail: MailDetail) => {
        setReplyTo(null);
        setComposeMode('forward');
        setOriginalMailForAi(mail);
        setOriginalHtmlBody(buildForwardHtml(mail));
        setAttachments(mail.attachments.map(att => ({messageId: mail.id, id: att.id, filename: att.filename, mimeType: att.mimeType, size: att.size, forwarded: true as const})));
        setComposeFields({
            to: [],
            cc: [],
            bcc: [],
            subject: `Fwd: ${mail.subject.replace(/^fwd:\s*/i, '') || ''}`,
            body: addMailSignature('', signatureEnabled ? mailSignature : ''),
        });
        setIsCcVisible(false);
        setIsBccVisible(false);
        setIsMacroMenuOpen(false);
        setCompose(true);
    };
    const forwardSelectedMail = () => {
        if (selected) forwardMail(selected);
    };
    const previewAttachment = async (attachment: MailAttachment, messageId = selected?.id) => {
        if (!selected) return;
        if (!messageId) return;
        const file = await api.getGoogleMailAttachment(messageId, attachment.id, attachment.mimeType);
        const previewMimeType = getAttachmentPreviewMimeType(attachment);
        if (!previewMimeType) return;
        const previewFile = file.type === previewMimeType ? file : new Blob([file], {type: previewMimeType});
        setAttachmentPreview(previous => {
            if (previous?.url) URL.revokeObjectURL(previous.url);
            return previewMimeType === DOCX_MIME_TYPE
                ? {filename: attachment.filename, mimeType: previewMimeType, docx: previewFile}
                : {filename: attachment.filename, mimeType: previewMimeType, url: URL.createObjectURL(previewFile)};
        });
    };
    const downloadAttachment = async (attachment: MailAttachment, messageId = selected?.id) => {
        if (!selected) return;
        if (!messageId) return;
        const file = await api.getGoogleMailAttachment(messageId, attachment.id, attachment.mimeType);
        const url = URL.createObjectURL(file);
        const downloadLink = document.createElement('a');
        downloadLink.href = url;
        downloadLink.download = attachment.filename;
        downloadLink.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
    };
    const attachMailAttachmentToChat = async (attachment: MailAttachment, messageId?: string) => {
        if (!onAttachFilesToChat || isAttachingToChat || !messageId || !isSupportedChatMailAttachment(attachment)) return;
        setMailChatAttachLabel(attachment.filename);
        setIsAttachingToChat(true);
        try {
            const blob = await api.getGoogleMailAttachment(messageId, attachment.id, attachment.mimeType);
            const file = new File([blob], attachment.filename, {
                type: getAttachmentPreviewMimeType(attachment) || attachment.mimeType,
            });
            await onAttachFilesToChat([file]);
        } catch (error) {
            console.error('Mail attachment chat attach failed:', error);
            toast.error(t('googleWorkspace.mailAttachFailed'));
        } finally {
            setIsAttachingToChat(false);
            setMailChatAttachLabel('');
        }
    };
    const closeAttachmentPreview = () => setAttachmentPreview(previous => {
        if (previous?.url) URL.revokeObjectURL(previous.url);
        return null;
    });
    useEffect(() => {
        if (!attachmentPreview) return;
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                closeAttachmentPreview();
            }
        };
        window.addEventListener('keydown', closeOnEscape, true);
        return () => window.removeEventListener('keydown', closeOnEscape, true);
    }, [attachmentPreview]);
    const MailAttachmentItem = ({attachment, messageId, onSelect}: {attachment: MailAttachment; messageId?: string; onSelect?: () => void}) => {
        const isPreviewable = Boolean(getAttachmentPreviewMimeType(attachment));
        const operationKey = `${messageId || selected?.id || ''}:${attachment.id}`;
        const isPreparingPreview = mailAttachmentOperation?.key === operationKey && mailAttachmentOperation.action === 'preview';
        const isPreparingDownload = mailAttachmentOperation?.key === operationKey && mailAttachmentOperation.action === 'download';
        const isAttachableToChat = isSupportedChatMailAttachment(attachment);
        const runAttachmentOperation = async (action: 'preview' | 'download') => {
            if (mailAttachmentOperation) return;
            onSelect?.();
            setMailAttachmentOperation({key: operationKey, action, filename: attachment.filename});
            try {
                if (action === 'preview') await previewAttachment(attachment, messageId);
                else await downloadAttachment(attachment, messageId);
            } catch (error) {
                console.error(`Mail attachment ${action} failed:`, error);
                toast.error(t(action === 'preview'
                    ? 'googleWorkspace.attachmentPreviewFailed'
                    : 'googleWorkspace.downloadFailed'));
            } finally {
                setMailAttachmentOperation(null);
            }
        };
        return <div className="gwp-mail-attachment-item">
            <button className="gwp-mail-attachment-open" disabled={Boolean(mailAttachmentOperation)} onClick={() => {
                void runAttachmentOperation(isPreviewable ? 'preview' : 'download');
            }}>
                {isPreparingPreview
                    ? <LoaderCircle aria-hidden="true" size={18} className="gwp-spin"/>
                    : <FileText aria-hidden="true" size={18}/>}
                <span>{attachment.filename}</span>
            </button>
            {isAttachableToChat && <button className="gwp-mail-attachment-attach"
                    disabled={Boolean(mailAttachmentOperation) || isAttachingToChat}
                    aria-label={t('googleWorkspace.attachToChat')}
                    onClick={() => void attachMailAttachmentToChat(attachment, messageId)}>
                {isAttachingToChat
                    ? <LoaderCircle aria-hidden="true" size={16} className="gwp-spin"/>
                    : <MessageSquarePlus aria-hidden="true" size={16}/>}
            </button>}
            <button className="gwp-mail-attachment-download" disabled={Boolean(mailAttachmentOperation)}
                    aria-label={t('googleWorkspace.attachmentDownload', {name: attachment.filename})}
                    onClick={() => void runAttachmentOperation('download')}>
                {isPreparingDownload
                    ? <LoaderCircle aria-hidden="true" size={16} className="gwp-spin"/>
                    : <Download aria-hidden="true" size={16}/>}
            </button>
        </div>;
    };

    const labelsById = new Map(labels.map(item => [item.id, item]));
    const selectedMailCategoryName = label in SYSTEM_LABELS
        ? t(`googleWorkspace.${SYSTEM_LABELS[label as keyof typeof SYSTEM_LABELS].nameKey}`)
        : labelsById.get(label)?.name || t('googleWorkspace.mail');
    const attachmentBytes = attachments.reduce((total, file) => total + file.size, 0);
    const attachmentLimitExceeded = attachmentBytes > MAX_MAIL_ATTACHMENT_BYTES;
    const canSendMail = Boolean(composeFields.to.length && composeFields.subject.trim() && (composeFields.body.replace(/<p><\/p>/g, '').trim() || originalHtmlBody)) && !attachmentLimitExceeded;
    const isMailActionBusy = isOpeningMail || isRefreshingSentReply || isTrashingMails || isMovingMails || isApplyingLabel;
    const formatAttachmentSize = (bytes: number) => {
        if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
        if (bytes >= 1024) return `${(bytes / 1024).toFixed(bytes >= 10 * 1024 ? 0 : 1)} KB`;
        return `${bytes} B`;
    };
    const primarySystemLabels = PRIMARY_SYSTEM_LABEL_IDS.filter(id => labelsById.has(id));
    const collapsibleSystemLabels = COLLAPSIBLE_SYSTEM_LABEL_IDS.filter(id => labelsById.has(id));
    const userLabels = labels.filter(item => item.type === 'user');
    const renderAppliedLabels = (labelIds?: string[]) => {
        const appliedLabels = (labelIds || [])
            .map(labelId => labelsById.get(labelId))
            .filter((item): item is MailLabel => item?.type === 'user');
        if (!appliedLabels.length) return null;
        return <span className="gwp-applied-labels">
            {appliedLabels.map(item => <span className="gwp-applied-label" key={item.id}>{item.name}</span>)}
        </span>;
    };
    const moveTargetLabels = [
        ...(['INBOX', 'SPAM', 'TRASH'] as const)
            .filter(id => id !== label)
            .map(id => ({id, name: t(`googleWorkspace.${SYSTEM_LABELS[id].nameKey}`), unreadCount: labelsById.get(id)?.unreadCount || 0})),
        ...userLabels.filter(item => item.id !== label).map(item => ({id: item.id, name: item.name, unreadCount: item.unreadCount || 0})),
    ];
    const signatureTemplateOptions = [
        {value: 'business', label: t('googleWorkspace.signatureTemplateBusiness')},
        {value: 'compact', label: t('googleWorkspace.signatureTemplateCompact')},
        {value: 'minimal', label: t('googleWorkspace.signatureTemplateMinimal')},
        {value: 'classic', label: t('googleWorkspace.signatureTemplateClassic')},
    ];
    const mailMacroOptions = mailMacros.map(item => ({value: item.id, label: item.title}));
    const canSaveCurrentMailBody = Boolean(getPlainTextFromHtml(getMailBodyWithoutSignature(composeFields.body)).trim());
    const renderMailParticipants = (mail: MailItem) => {
        const participants = mail.participants?.map(participant => (
            participant.isMe ? t('googleWorkspace.me') : participant.name || participant.email
        )).filter(Boolean);
        const senderNames = participants?.length ? participants.join(', ') : mail.from;
        return <>
            <span className="gwp-mail-participants">{senderNames}</span>
            {mail.messageCount && mail.messageCount > 1
                ? <span className="gwp-mail-thread-count">{mail.messageCount}</span>
                : null}
        </>;
    };
    const SystemLabelButton = ({id, active, onClick}: {id: keyof typeof SYSTEM_LABELS; active: boolean; onClick: () => void}) => {
        const {icon: Icon, nameKey} = SYSTEM_LABELS[id];
        const unreadCount = labelsById.get(id)?.unreadCount || 0;
        return <button className={active ? 'active' : ''} onClick={onClick}>
            <Icon aria-hidden="true" size={18}/>
            <span>{t(`googleWorkspace.${nameKey}`)}</span>
            {(id === 'INBOX' || id === 'SPAM') && unreadCount > 0 && <strong className="gwp-label-unread-count" aria-label={String(unreadCount)}>{unreadCount}</strong>}
        </button>;
    };
    const SelectedMailLabelAction = () => <div className="gwp-label-apply-wrap">
        <button
            className="gwp-label-apply-button"
            aria-label={t('googleWorkspace.applyLabel')}
            aria-expanded={labelApplyMenuOpen}
            onClick={() => {
                setMoveMenuOpen(false);
                setLabelApplyMenuOpen(current => !current);
            }}
            disabled={isMailActionBusy}
        >
            {isApplyingLabel ? <LoaderCircle aria-hidden="true" size={17} className="gwp-spin"/> : <Tag aria-hidden="true" size={17}/>}
        </button>
        {labelApplyMenuOpen && <div className="gwp-label-apply-menu">
            <strong>{t('googleWorkspace.applyLabel')}</strong>
            {userLabels.length > 0
                ? userLabels.map(target => <button key={target.id} onClick={() => void applyLabelToSelectedMails(target.id)}><Tag aria-hidden="true" size={16}/><span>{target.name}</span></button>)
                : <span className="gwp-label-apply-empty">{t('googleWorkspace.noLabels')}</span>}
        </div>}
    </div>;
    const MailListSkeleton = () => <div className="gwp-mail-skeleton" aria-label={t('googleWorkspace.loading')}>
        {[0, 1, 2, 3, 4].map(index => <div className="gwp-skeleton-row" key={index}><span/><span/><span/></div>)}
    </div>;
    const MailSenderDetails = ({mail, compact = false}: {mail: MailDetail; compact?: boolean}) => {
        const detailsRef = useRef<HTMLDetailsElement>(null);
        const tooltipRef = useRef<HTMLDivElement>(null);
        const [copiedEmail, setCopiedEmail] = useState('');
        const [recipientDetailsOpen, setRecipientDetailsOpen] = useState(false);
        const [recipientTooltipPosition, setRecipientTooltipPosition] = useState({top: 8, left: 8});
        useEffect(() => {
            const closeWhenClickingOutside = (event: Event) => {
                const details = detailsRef.current;
                const target = event.target;
                if (details?.open && (!(target instanceof Node) || !details.contains(target))) {
                    setRecipientDetailsOpen(false);
                }
            };
            const closeWhenIframeFocused = () => {
                window.setTimeout(() => {
                    if (document.activeElement instanceof HTMLIFrameElement) setRecipientDetailsOpen(false);
                }, 0);
            };
            document.addEventListener('pointerdown', closeWhenClickingOutside);
            window.addEventListener(EMAIL_BODY_INTERACTION_EVENT, closeWhenClickingOutside);
            window.addEventListener('blur', closeWhenIframeFocused);
            return () => {
                document.removeEventListener('pointerdown', closeWhenClickingOutside);
                window.removeEventListener(EMAIL_BODY_INTERACTION_EVENT, closeWhenClickingOutside);
                window.removeEventListener('blur', closeWhenIframeFocused);
            };
        }, []);
        useLayoutEffect(() => {
            if (!recipientDetailsOpen) return;

            const updateTooltipPosition = () => {
                const anchor = detailsRef.current?.querySelector('summary');
                const tooltip = tooltipRef.current;
                if (!anchor || !tooltip) return;

                const anchorRect = anchor.getBoundingClientRect();
                const tooltipRect = tooltip.getBoundingClientRect();
                const viewportPadding = 8;
                const shouldOpenUpward = window.innerHeight - anchorRect.bottom < tooltipRect.height + viewportPadding;
                const top = shouldOpenUpward
                    ? Math.max(viewportPadding, anchorRect.top - tooltipRect.height - 6)
                    : anchorRect.bottom + 6;
                const left = Math.min(
                    Math.max(viewportPadding, anchorRect.left),
                    Math.max(viewportPadding, window.innerWidth - tooltipRect.width - viewportPadding),
                );

                setRecipientTooltipPosition({top, left});
            };

            updateTooltipPosition();
            window.addEventListener('resize', updateTooltipPosition);
            return () => window.removeEventListener('resize', updateTooltipPosition);
        }, [recipientDetailsOpen]);
        useEffect(() => {
            if (!copiedEmail) return;
            const timeoutId = window.setTimeout(() => setCopiedEmail(''), 1800);
            return () => window.clearTimeout(timeoutId);
        }, [copiedEmail]);
        const copyEmail = async (email: string) => {
            if (await copyToClipboard(email)) setCopiedEmail(email);
        };
        const MailAddressRow = ({recipient}: {recipient: MailAddress}) => <strong className="gwp-recipient-address" role="button" tabIndex={0} onClick={() => void copyEmail(recipient.email)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void copyEmail(recipient.email); } }}>
            <span className="gwp-recipient-address-text">
                {recipient.name && <span>{recipient.name}</span>}
                <span>{recipient.name ? `<${recipient.email}>` : recipient.email}</span>
                {mail.accountEmail && recipient.email.toLowerCase() === mail.accountEmail.toLowerCase() && <em>{t('googleWorkspace.me')}</em>}
            </span>
            {copiedEmail === recipient.email && <small role="status" aria-label={t('memoModal.copied')}><CheckCircle2 aria-hidden="true" size={14}/></small>}
        </strong>;
        const sender = parseMailAddress(mail.from);
        const recipientDetails = <div ref={tooltipRef} className="gwp-recipient-tooltip" style={recipientTooltipPosition}>
            {sender.email && <div><span>{t('googleWorkspace.sender')}</span><MailAddressRow recipient={sender}/></div>}
            {mail.to.length > 0 && <div><span>{t('googleWorkspace.recipient')}</span>{mail.to.map(recipient => <MailAddressRow key={`to-${recipient.email}`} recipient={recipient}/>)}</div>}
            {mail.cc.length > 0 && <div><span>{t('googleWorkspace.cc')}</span>{mail.cc.map(recipient => <MailAddressRow key={`cc-${recipient.email}`} recipient={recipient}/>)}</div>}
            {mail.bcc.length > 0 && <div><span>{t('googleWorkspace.bcc')}</span>{mail.bcc.map(recipient => <MailAddressRow key={`bcc-${recipient.email}`} recipient={recipient}/>)}</div>}
        </div>;

        const details = <details className="gwp-message-sender" ref={detailsRef} open={recipientDetailsOpen} onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
            <summary aria-label={t('googleWorkspace.recipientDetails')} onMouseDown={event => event.preventDefault()} onClick={event => {
                event.preventDefault();
                const willOpen = !recipientDetailsOpen;
                setRecipientDetailsOpen(willOpen);
                if (willOpen) event.currentTarget.focus({preventScroll: true});
            }}>{!compact && <strong>{mail.from}</strong>}<ChevronDown aria-hidden="true" size={13}/></summary>
            {recipientDetails}
        </details>;
        return compact
            ? <div className="gwp-message-sender-compact"><strong>{mail.from}</strong>{details}</div>
            : details;
    };
    const MailAttachments = ({attachments: messageAttachments, messageId}: {attachments: MailAttachment[]; messageId: string}) => {
        const detailsRef = useRef<HTMLDetailsElement>(null);
        useEffect(() => {
            const closeWhenClickingOutside = (event: Event) => {
                const details = detailsRef.current;
                const target = event.target;
                if (details?.open && (!(target instanceof Node) || !details.contains(target))) {
                    details.removeAttribute('open');
                }
            };
            document.addEventListener('pointerdown', closeWhenClickingOutside);
            window.addEventListener(EMAIL_BODY_INTERACTION_EVENT, closeWhenClickingOutside);
            return () => {
                document.removeEventListener('pointerdown', closeWhenClickingOutside);
                window.removeEventListener(EMAIL_BODY_INTERACTION_EVENT, closeWhenClickingOutside);
            };
        }, []);
        const close = () => detailsRef.current?.removeAttribute('open');

        return <section className="gwp-mail-attachments">
            <details ref={detailsRef}>
                <summary aria-label={t('googleWorkspace.attachments', {count: messageAttachments.length})}>
                    <Paperclip aria-hidden="true" size={16}/><strong>{messageAttachments.length}</strong>
                </summary>
                <div className="gwp-mail-attachment-list">
                    {messageAttachments.map(attachment => <MailAttachmentItem key={attachment.id} attachment={attachment} messageId={messageId} onSelect={close}/>)}
                </div>
            </details>
        </section>;
    };
    const getMailAttachments = (mail: MailDetail) => {
        const messages = mail.threadMessages?.length
            ? mail.threadMessages
            : [{id: mail.id, attachments: mail.attachments}];
        return messages.flatMap(message => (message.attachments || []).map(attachment => ({
            ...attachment,
            messageId: message.id,
        })));
    };
    const attachMailToChat = async (mail: MailDetail, includeContent: boolean) => {
        if (!onAttachFilesToChat || isAttachingToChat) return;
        const allAttachments = getMailAttachments(mail);
        const supportedAttachments = allAttachments.filter(isSupportedChatMailAttachment);
        setMailAttachMenuId(null);
        setMailChatAttachLabel(mail.threadMessages?.length
            ? t('googleWorkspace.mailThreadAttachmentLabel', {
                subject: mail.subject || t('googleWorkspace.noSubject'),
                count: mail.threadMessages.length,
            })
            : mail.subject || t('googleWorkspace.noSubject'));
        setIsAttachingToChat(true);
        try {
            const downloadedFiles = await Promise.all(supportedAttachments.map(async attachment => {
                const blob = await api.getGoogleMailAttachment(attachment.messageId, attachment.id, attachment.mimeType);
                return new File([blob], attachment.filename, {
                    type: getAttachmentPreviewMimeType(attachment) || attachment.mimeType,
                });
            }));
            const files = [...downloadedFiles];
            if (includeContent) {
                const messages = mail.threadMessages?.length ? mail.threadMessages : [{
                    id: mail.id,
                    from: mail.from,
                    to: mail.to.map(address => address.email).join(', '),
                    cc: mail.cc.map(address => address.email).join(', '),
                    bcc: mail.bcc.map(address => address.email).join(', '),
                    subject: mail.subject,
                    date: mail.date,
                    body: mail.body,
                    htmlBody: mail.htmlBody,
                    attachments: mail.attachments,
                }];
                const inlineImageFiles = await extractMailBodyImageFiles(messages);
                const mailText = messages.map((message, messageIndex) => {
                    const messageAttachments = (message.attachments || []).filter(isSupportedChatMailAttachment);
                    return [
                    `[${t('googleWorkspace.message')} ${messageIndex + 1}/${messages.length}]`,
                    `${t('googleWorkspace.sender')}: ${message.from}`,
                    `${t('googleWorkspace.recipient')}: ${message.to}`,
                    message.cc ? `Cc: ${message.cc}` : '',
                    message.bcc ? `Bcc: ${message.bcc}` : '',
                    `${t('googleWorkspace.date')}: ${message.date}`,
                    `${t('googleWorkspace.subject')}: ${message.subject}`,
                    `${t('googleWorkspace.attachments', {count: messageAttachments.length})}: ${messageAttachments.map(attachment => attachment.filename).join(', ') || '-'}`,
                    '',
                    htmlToPlainText(message.body),
                ].filter(Boolean).join('\n');
                }).join('\n\n---\n\n');
                const safeSubject = (mail.subject || t('googleWorkspace.noSubject'))
                    .replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);
                files.unshift(new File([mailText], `${safeSubject}.txt`, {type: 'text/plain'}));
                files.push(...inlineImageFiles);
            }
            if (!files.length) {
                toast.warning(t('googleWorkspace.noAttachableMailFiles'));
                return;
            }
            await onAttachFilesToChat(files);
            if (supportedAttachments.length < allAttachments.length) {
                toast.warning(t('googleWorkspace.unsupportedMailAttachmentsSkipped', {
                    count: allAttachments.length - supportedAttachments.length,
                }));
            }
        } catch (error) {
            console.error('Mail attach failed:', error);
            toast.error(t('googleWorkspace.mailAttachFailed'));
        } finally {
            setIsAttachingToChat(false);
            setMailChatAttachLabel('');
        }
    };
    const MailChatAttachMenu = ({mail, menuId, onDelete}: {
        mail: MailDetail;
        menuId: string;
        onDelete?: () => void;
    }) => {
        if (!onAttachFilesToChat && !onDelete) return null;
        const hasSupportedAttachment = getMailAttachments(mail).some(isSupportedChatMailAttachment);
        const isOpen = mailAttachMenuId === menuId;
        return <div className="gwp-mail-attach-menu-wrap" onPointerDown={event => event.stopPropagation()}>
            <button className="gwp-mail-more-button" onClick={event => {
                event.stopPropagation();
                if (isOpen) {
                    setMailAttachMenuId(null);
                    setMailAttachMenuOpensUpward(false);
                    return;
                }
                const menuItemCount = (onAttachFilesToChat ? 2 : 0) + (onDelete ? 1 : 0);
                const estimatedMenuHeight = 16 + menuItemCount * 44;
                const triggerRect = event.currentTarget.getBoundingClientRect();
                setMailAttachMenuOpensUpward(window.innerHeight - triggerRect.bottom < estimatedMenuHeight + 8);
                setMailAttachMenuId(menuId);
            }} disabled={isAttachingToChat} aria-label={t('googleWorkspace.attachmentOptions')}>
                {isAttachingToChat && isOpen
                    ? <LoaderCircle aria-hidden="true" size={17} className="gwp-spin"/>
                    : <MoreVertical aria-hidden="true" size={18}/>}
            </button>
            {isOpen && <div className={`gwp-mail-attach-menu${mailAttachMenuOpensUpward ? ' gwp-mail-attach-menu--upward' : ''}`} onClick={event => event.stopPropagation()}>
                {onAttachFilesToChat && <>
                    <button onClick={() => void attachMailToChat(mail, true)} disabled={isAttachingToChat}>
                        <MessageSquarePlus aria-hidden="true" size={16}/><span>{t('googleWorkspace.attachMailWithContent')}</span>
                    </button>
                    <button onClick={() => void attachMailToChat(mail, false)} disabled={isAttachingToChat || !hasSupportedAttachment}>
                        <MessageSquarePlus aria-hidden="true" size={16}/><span>{t('googleWorkspace.attachMailFilesOnly')}</span>
                    </button>
                </>}
                {onDelete && <button className="gwp-mail-menu-delete" onClick={() => {
                    setMailAttachMenuId(null);
                    setMailAttachMenuOpensUpward(false);
                    onDelete();
                }} disabled={isMailActionBusy}>
                    <Trash2 aria-hidden="true" size={16}/><span>{t('googleWorkspace.delete')}</span>
                </button>}
            </div>}
        </div>;
    };
    const MailOperationOverlay = () => {
        const label = mailAttachmentOperation?.filename || mailChatAttachLabel;
        if (!mailAttachmentOperation && !isAttachingToChat) return null;
        const message = isAttachingToChat
            ? t('googleWorkspace.attachingFile')
            : t(mailAttachmentOperation?.action === 'preview'
                ? 'googleWorkspace.preparingAttachmentPreview'
                : 'googleWorkspace.preparingAttachmentDownload');
        return <div className="gwp-drive-upload-overlay gwp-mail-operation-overlay" role="status">
            <span className="gwp-drive-upload-spinner-lg"/>
            <strong>{message}</strong>
            <span className="gwp-drive-upload-count">{label}</span>
        </div>;
    };
    const renderMailThread = () => {
        if (!selected) return null;
        const threadMessages: MailThreadMessage[] = selected.threadMessages?.length
            ? selected.threadMessages
            : [{
                id: selected.id,
                from: selected.from,
                to: selected.to.map(address => address.email).join(', '),
                cc: selected.cc.map(address => address.email).join(', '),
                bcc: selected.bcc.map(address => address.email).join(', '),
                toAddresses: selected.to,
                ccAddresses: selected.cc,
                bccAddresses: selected.bcc,
                subject: selected.subject,
                date: selected.date,
                body: selected.body,
                htmlBody: selected.htmlBody,
                attachments: selected.attachments,
            }];
        const toggleThreadMessage = (messageId: string) => {
            setExpandedThreadMessageIds(current => {
                const next = new Set(current);
                if (next.has(messageId)) next.delete(messageId);
                else next.add(messageId);
                return next;
            });
        };
        if (threadMessages.length === 1) {
            const message = threadMessages[0];
            const messageDetail: MailDetail = {
                id: message.id,
                threadId: selected.threadId,
                from: message.from,
                to: message.toAddresses || selected.to,
                cc: message.ccAddresses || selected.cc,
                bcc: message.bccAddresses || selected.bcc,
                accountEmail: selected.accountEmail,
                subject: message.subject,
                date: message.date,
                body: message.body,
                htmlBody: message.htmlBody,
                attachments: message.attachments || [],
                threadMessages: selected.threadMessages,
            };
            return <section className="gwp-detail gwp-detail--html">
                <MailOperationOverlay/>
                <div className="gwp-toolbar gwp-detail-toolbar">
                    <button className="gwp-back" onClick={() => { closeAttachmentPreview(); setSelected(null); }}>
                        <ChevronLeft aria-hidden="true" size={17}/><span>{selectedMailCategoryName}</span>
                    </button>
                    <div className="gwp-detail-actions">
                        <MailChatAttachMenu mail={selected} menuId="whole-thread"/>
                        <KnowledgeCollectionAttachSelect source={{source_type: 'email_thread', source_id: selectedKnowledgeSourceId || selected.threadId || selected.id}} prepareSource={async () => ({source_type: 'email_thread', source_id: (await api.indexGoogleMailThreadForKnowledge(selected.threadId || selected.id, accountId)).source_id})}/>
                        <button className="gwp-detail-delete" onClick={() => void trashSelectedThread()} disabled={isMailActionBusy}>{isTrashingMails ? <LoaderCircle aria-hidden="true" size={16} className="gwp-spin"/> : <Trash2 aria-hidden="true" size={16}/>}<span>{t('googleWorkspace.delete')}</span></button>
                        <button className="gwp-detail-forward" onClick={forwardSelectedMail} disabled={isMailActionBusy}><Forward aria-hidden="true" size={16}/><span>{t('googleWorkspace.forward')}</span></button>
                        <button className="gwp-primary" onClick={replyToSelectedMail}>{t('googleWorkspace.reply')}</button>
                    </div>
                </div>
                <div className="gwp-single-message-scroll">
                    <header className="gwp-message-header">
                        <div className="gwp-message-icon"><Mail aria-hidden="true" size={19}/></div>
                        <div className="gwp-message-heading">
                            <div className="gwp-message-title-line">{renderAppliedLabels(selected.labelIds)}<h3>{message.subject || t('googleWorkspace.noSubject')}</h3></div>
                            <div className="gwp-message-meta">
                                <div>
                                    <span className="gwp-participants-label"><span>{t('googleWorkspace.sender')}</span><i aria-hidden="true">·</i><span>{t('googleWorkspace.recipient')}</span></span>
                                    <MailSenderDetails mail={messageDetail}/>
                                </div>
                                <div><span>{t('googleWorkspace.receivedAt')}</span><time dateTime={message.date}>{formatReceivedDate(message.date, i18n.resolvedLanguage || i18n.language)}</time></div>
                            </div>
                        </div>
                    </header>
                    <div className="gwp-email-frame gwp-email-frame--single"><EmailBody mail={message} fillAvailableSpace/></div>
                </div>
                {messageDetail.attachments.length > 0 && <MailAttachments attachments={messageDetail.attachments} messageId={message.id}/>}
            </section>;
        }

        return <section className="gwp-detail gwp-detail--html">
            <MailOperationOverlay/>
            <div className="gwp-toolbar gwp-detail-toolbar">
                <button className="gwp-back" onClick={() => { closeAttachmentPreview(); setSelected(null); }}>
                    <ChevronLeft aria-hidden="true" size={17}/><span>{selectedMailCategoryName}</span>
                </button>
                <div className="gwp-detail-actions">
                    <MailChatAttachMenu mail={selected} menuId="whole-thread"/>
                    <KnowledgeCollectionAttachSelect source={{source_type: 'email_thread', source_id: selectedKnowledgeSourceId || selected.threadId || selected.id}} prepareSource={async () => ({source_type: 'email_thread', source_id: (await api.indexGoogleMailThreadForKnowledge(selected.threadId || selected.id, accountId)).source_id})}/>
                    <button className="gwp-detail-delete" onClick={() => void trashSelectedThread()} disabled={isMailActionBusy}>{isTrashingMails ? <LoaderCircle aria-hidden="true" size={16} className="gwp-spin"/> : <Trash2 aria-hidden="true" size={16}/>}<span>{t('googleWorkspace.delete')}</span></button>
                    <button className="gwp-detail-forward" onClick={forwardSelectedMail} disabled={isMailActionBusy}><Forward aria-hidden="true" size={16}/><span>{t('googleWorkspace.forward')}</span></button>
                    <button className="gwp-primary" onClick={replyToSelectedMail}>{t('googleWorkspace.reply')}</button>
                </div>
            </div>
            <header className="gwp-thread-title">
                <Mail aria-hidden="true" size={20}/>
                {renderAppliedLabels(selected.labelIds)}
                <h3>{selected.subject.replace(/^(re|fwd):\s*/i, '') || t('googleWorkspace.noSubject')}</h3>
                {threadMessages.length > 1 && <span>{threadMessages.length}</span>}
            </header>
            <div className="gwp-thread-scroll">
                {threadMessages.map((message, index) => {
                    const expanded = expandedThreadMessageIds.has(message.id);
                    const messageDetail: MailDetail = {
                        id: message.id,
                        threadId: selected.threadId,
                        from: message.from,
                        to: message.toAddresses || [],
                        cc: message.ccAddresses || [],
                        bcc: message.bccAddresses || [],
                        accountEmail: selected.accountEmail,
                        subject: message.subject,
                        date: message.date,
                        body: message.body,
                        htmlBody: message.htmlBody,
                        attachments: message.attachments || [],
                        threadMessages: selected.threadMessages,
                    };
                    const collapsedPreview = htmlToPlainText(message.body || message.htmlBody || '').replace(/\s+/g, ' ').trim();
                    return <article className={`gwp-thread-message${expanded ? ' is-expanded' : ''}`} key={message.id}>
                        <div className="gwp-thread-message-summary" onClick={() => toggleThreadMessage(message.id)}>
                            <span className="gwp-thread-message-index">{index + 1}</span>
                            <div className="gwp-thread-message-summary-text">
                                <MailSenderDetails mail={messageDetail} compact/>
                                {!expanded && <small>{collapsedPreview}</small>}
                            </div>
                            {expanded && <div className="gwp-thread-message-actions" onClick={event => event.stopPropagation()}>
                                <button onClick={() => replyToMail(messageDetail)} aria-label={t('googleWorkspace.reply')} title={t('googleWorkspace.reply')}><Reply aria-hidden="true" size={16}/></button>
                                <button onClick={() => forwardMail(messageDetail)} aria-label={t('googleWorkspace.forward')} title={t('googleWorkspace.forward')}><Forward aria-hidden="true" size={16}/></button>
                            </div>}
                            <MailChatAttachMenu
                                mail={{...messageDetail, threadMessages: undefined}}
                                menuId={`message-${message.id}`}
                                onDelete={() => void trashThreadMessage(message.id)}
                            />
                            <time dateTime={message.date}>{formatReceivedDate(message.date, i18n.resolvedLanguage || i18n.language)}</time>
                            <button className="gwp-thread-message-toggle" onClick={event => { event.stopPropagation(); toggleThreadMessage(message.id); }} aria-expanded={expanded} aria-label={expanded ? t('googleWorkspace.collapse') : t('googleWorkspace.expand')}>
                                {expanded ? <ChevronUp aria-hidden="true" size={17}/> : <ChevronDown aria-hidden="true" size={17}/>}
                            </button>
                        </div>
                        {expanded && <>
                            <div className="gwp-thread-message-body"><EmailBody mail={message}/></div>
                            {messageDetail.attachments.length > 0 && <MailAttachments attachments={messageDetail.attachments} messageId={message.id}/>}
                        </>}
                    </article>;
                })}
            </div>
        </section>;
    };

    return <>
        <div className="gwp-layout">
            <nav className="gwp-nav">
                <div className="gwp-compose-controls">
                    <button className="gwp-compose-button" onClick={openNewCompose}><PenLine aria-hidden="true" size={18}/><span>{t('googleWorkspace.compose')}</span></button>
                    <button className="gwp-signature-settings-button" aria-label={t('googleWorkspace.signatureSettings')} onClick={openSignatureSettings}><Settings aria-hidden="true" size={19}/></button>
                </div>
                <SystemLabelButton id="ALL_MAIL" active={label === 'ALL_MAIL'} onClick={() => selectLabel('ALL_MAIL')}/>
                <div className="gwp-mail-nav-separator" aria-hidden="true"/>
                {primarySystemLabels.map(id => <SystemLabelButton key={id} id={id as keyof typeof SYSTEM_LABELS} active={label === id} onClick={() => selectLabel(id)}/>) }
                {collapsibleSystemLabels.length > 0 && <button className="gwp-more-labels" onClick={() => setShowAllSystemLabels(current => !current)}>{showAllSystemLabels ? <ChevronUp size={18}/> : <ChevronDown size={18}/>}<span>{t(showAllSystemLabels ? 'googleWorkspace.less' : 'googleWorkspace.more')}</span></button>}
                {showAllSystemLabels && collapsibleSystemLabels.map(id => <SystemLabelButton key={id} id={id as keyof typeof SYSTEM_LABELS} active={label === id} onClick={() => selectLabel(id)}/>) }
                <div className="gwp-user-labels">
                    <div className="gwp-label-section-header">
                        <span className="gwp-label-section-title">{t('googleWorkspace.labels')}</span>
                        <button className="gwp-label-add-button" aria-label={t('googleWorkspace.addLabel')} onClick={() => setIsLabelCreateOpen(true)}><Plus aria-hidden="true" size={18}/></button>
                    </div>
                    {userLabels.map(item => <div className="gwp-user-label-row" key={item.id}>
                        <button className={`gwp-user-label-select${label === item.id ? ' active' : ''}`} onClick={() => selectLabel(item.id)}><Tag aria-hidden="true" size={18}/><span>{item.name}</span>{item.unreadCount > 0 && <strong className="gwp-label-unread-count" aria-label={String(item.unreadCount)}>{item.unreadCount}</strong>}</button>
                        <button className="gwp-label-delete-button" aria-label={t('googleWorkspace.deleteLabel', {name: item.name})} onClick={() => setLabelToDelete(item)}><Trash2 aria-hidden="true" size={15}/></button>
                    </div>)}
                </div>
            </nav>
            <main className="gwp-content">
                {selected ? renderMailThread() : <><div className="gwp-toolbar gwp-mail-toolbar"><label className="gwp-select-all"><input type="checkbox" checked={mails.length > 0 && selectedMailIds.size === mails.length} onChange={toggleAllMailSelection} disabled={isMailActionBusy}/><span>{selectedMailIds.size ? t('googleWorkspace.selected', {count: selectedMailIds.size}) : selectedMailCategoryName}</span></label><div>{selectedMailIds.size > 0 && <><SelectedMailLabelAction/><div className="gwp-move-selected-wrap"><button className="gwp-move-selected" aria-label={t('googleWorkspace.moveTo')} aria-expanded={moveMenuOpen} onClick={() => { setLabelApplyMenuOpen(false); setMoveMenuOpen(current => !current); }} disabled={isMailActionBusy}>{isMovingMails ? <LoaderCircle aria-hidden="true" size={17} className="gwp-spin"/> : <FolderInput aria-hidden="true" size={18}/>}</button>{moveMenuOpen && <div className="gwp-move-menu"><strong>{t('googleWorkspace.moveTo')}</strong>{moveTargetLabels.map(target => <button key={target.id} onClick={() => void moveSelectedMails(target.id)}><Tag aria-hidden="true" size={16}/><span>{target.name}</span>{target.unreadCount > 0 && <strong className="gwp-move-label-unread-count" aria-label={String(target.unreadCount)}>{target.unreadCount}</strong>}</button>)}</div>}</div><button className="gwp-trash-selected" aria-label={t('googleWorkspace.delete')} onClick={trashSelectedMails} disabled={isMailActionBusy}>{isTrashingMails ? <LoaderCircle aria-hidden="true" size={17} className="gwp-spin"/> : <Trash2 aria-hidden="true" size={17}/>}</button></>}<button className="gwp-refresh" aria-label={t('googleWorkspace.refresh')} onClick={refreshMails} disabled={mailLoading || isMailActionBusy}><RefreshCw aria-hidden="true" size={18} className={mailLoading ? 'gwp-spin' : ''}/></button></div></div>{mailLoading && mails.length === 0 ? <MailListSkeleton/> : mails.length === 0 ? <div className="gwp-mail-empty" role="status"><Mail aria-hidden="true" size={30}/><p>{t('googleWorkspace.emptyMailbox')}</p></div> : <div className="gwp-mail-scroll" onScroll={event => { const target = event.currentTarget; if (nextMailPageToken && !loadingMoreMails && !isMailActionBusy && target.scrollHeight - target.scrollTop - target.clientHeight < 96) void loadMails(nextMailPageToken); }}><div className="gwp-mail-list">{mails.map(mail => <div key={mail.threadId || mail.id} className={`gwp-mail-row${mail.isUnread ? ' unread' : ''}${label === 'TRASH' ? ' no-star' : ''}`}><input aria-label={t('googleWorkspace.selectMail')} type="checkbox" checked={selectedMailIds.has(mail.id)} onChange={() => toggleMailSelection(mail.id)} disabled={isMailActionBusy}/>{label !== 'TRASH' && <button className={`gwp-mail-star${mail.isStarred ? ' active' : ''}`} aria-label={t(mail.isStarred ? 'googleWorkspace.removeStar' : 'googleWorkspace.addStar')} aria-pressed={mail.isStarred} onClick={() => void toggleMailStar(mail)} disabled={isMailActionBusy || updatingStarMailIds.has(mail.id)}><Star aria-hidden="true" size={17}/></button>}<button className="gwp-mail-open" onClick={() => void openMail(mail.id)} disabled={isMailActionBusy}><strong>{renderMailParticipants(mail)}</strong><span className="gwp-mail-subject-line">{renderAppliedLabels(mail.labelIds)}<span className="gwp-mail-subject">{mail.subject || t('googleWorkspace.noSubject')}</span>{mail.hasAttachments && <Paperclip className="gwp-mail-attachment-indicator" aria-hidden="true" size={15}/>}</span><small>{mail.snippet}</small></button><time dateTime={mail.date}>{formatMailDate(mail.date)}</time></div>)}</div>{loadingMoreMails && <div className="gwp-mail-loading-more"><LoaderCircle aria-hidden="true" size={16} className="gwp-spin"/><span>{t('googleWorkspace.loadingMore')}</span></div>}</div>}</>}
            </main>
        </div>
        {isLabelCreateOpen && <ModalOverlay className="gwp-label-modal-overlay" onClose={() => { if (!isCreatingLabel) setIsLabelCreateOpen(false); }} closeOnBackdrop={!isCreatingLabel}>
            <form className="gwp-label-modal" aria-busy={isCreatingLabel} onSubmit={event => { event.preventDefault(); void createMailLabel(); }}>
                <header><h3>{t('googleWorkspace.newLabel')}</h3><button type="button" aria-label={t('googleWorkspace.close')} onClick={() => setIsLabelCreateOpen(false)} disabled={isCreatingLabel}><X aria-hidden="true" size={20}/></button></header>
                <label><span>{t('googleWorkspace.newLabelName')}</span><input autoFocus value={newLabelName} onChange={event => setNewLabelName(event.target.value)} maxLength={225} disabled={isCreatingLabel}/></label>
                <footer><button type="button" className="gwp-label-modal-cancel" onClick={() => setIsLabelCreateOpen(false)} disabled={isCreatingLabel}>{t('googleWorkspace.cancel')}</button><button type="submit" className="gwp-primary" disabled={!newLabelName.trim() || isCreatingLabel}>{isCreatingLabel ? <LoaderCircle aria-hidden="true" size={16} className="gwp-spin"/> : null}{t('googleWorkspace.create')}</button></footer>
            </form>
        </ModalOverlay>}
        {labelToDelete && <ConfirmModal
            title={t('googleWorkspace.deleteLabelTitle', {name: labelToDelete.name})}
            description={t('googleWorkspace.deleteLabelDescription')}
            options={[
                {label: t('googleWorkspace.cancel'), value: 'cancel'},
                {label: t('googleWorkspace.delete'), value: 'delete', variant: 'danger'},
            ]}
            onSelect={value => { if (value === 'delete') void deleteMailLabel(); else setLabelToDelete(null); }}
            onClose={() => { if (!isDeletingLabel) setLabelToDelete(null); }}
            actionLayout="horizontal"
            loading={isDeletingLabel}
            loadingValue="delete"
            loadingLabel={t('googleWorkspace.processing')}
        />}
        {compose && <div className="gwp-compose-backdrop"><form className="gwp-compose" noValidate onSubmit={event => { event.preventDefault(); send(event.currentTarget); }}><header><h3>{replyTo ? t('googleWorkspace.reply') : t('googleWorkspace.compose')}</h3><button type="button" aria-label={t('googleWorkspace.close')} onClick={closeCompose} disabled={aiGenerating || isSending}><X aria-hidden="true" size={24}/></button></header><div className="gwp-recipient-fields"><MailRecipientField name="to" label={t('googleWorkspace.recipient')} recipients={composeFields.to} suggestions={recipientSuggestions} onChange={to => setComposeFields(current => ({...current, to}))} invalidEmailMessage={t('googleWorkspace.invalidEmail')} removeLabel={email => t('googleWorkspace.removeRecipient', {email})} trailingAction={<span className="gwp-recipient-actions">{!isCcVisible && <button type="button" onClick={() => setIsCcVisible(true)}>{t('googleWorkspace.cc')}</button>}{!isBccVisible && <button type="button" onClick={() => setIsBccVisible(true)}>{t('googleWorkspace.bcc')}</button>}</span>}/>{isCcVisible && <MailRecipientField name="cc" label={t('googleWorkspace.cc')} recipients={composeFields.cc} suggestions={recipientSuggestions} onChange={cc => setComposeFields(current => ({...current, cc}))} invalidEmailMessage={t('googleWorkspace.invalidEmail')} removeLabel={email => t('googleWorkspace.removeRecipient', {email})}/>} {isBccVisible && <MailRecipientField name="bcc" label={t('googleWorkspace.bcc')} recipients={composeFields.bcc} suggestions={recipientSuggestions} onChange={bcc => setComposeFields(current => ({...current, bcc}))} invalidEmailMessage={t('googleWorkspace.invalidEmail')} removeLabel={email => t('googleWorkspace.removeRecipient', {email})}/>}</div><div className="gwp-compose-subject-row"><input name="subject" value={composeFields.subject} onChange={event => setComposeFields(current => ({...current, subject: event.target.value}))} placeholder={t('googleWorkspace.subject')}/><div className="gwp-compose-macro-menu" ref={macroMenuRef}><button type="button" className="gwp-macro-menu-button" aria-label={t('googleWorkspace.applyMacro')} title={t('googleWorkspace.applyMacro')} aria-expanded={isMacroMenuOpen} onClick={() => setIsMacroMenuOpen(open => !open)}><FileText aria-hidden="true" size={17}/></button>{isMacroMenuOpen && <div className="gwp-macro-menu-popover">{mailMacroOptions.length > 0 && <CustomSelect className="gwp-mail-macro-select" value={selectedMacroId} options={mailMacroOptions} placeholder={t('googleWorkspace.applyMacro')} onChange={value => { applyMailMacro(value); setIsMacroMenuOpen(false); }}/>}<button type="button" className="gwp-save-macro-button" aria-label={t('googleWorkspace.saveMacro')} title={t('googleWorkspace.saveMacro')} onClick={openMacroSaveDialog} disabled={!canSaveCurrentMailBody || isSending}><Save aria-hidden="true" size={17}/></button></div>}</div></div>{replyTo && <input type="hidden" name="reply_to" value={replyTo.id}/>}<EmailEditor ref={emailEditorRef} content={composeFields.body} onChange={body => setComposeFields(current => ({...current, body}))} placeholder={t('googleWorkspace.message')} lockMailSignature originalHtmlSrcDoc={originalHtmlBody ? createEmailDocument(removeDarkModeStyles(originalHtmlBody)) : undefined}/>
<div className="gwp-compose-macro">{mailMacroOptions.length > 0 && <CustomSelect className="gwp-mail-macro-select" value={selectedMacroId} options={mailMacroOptions} placeholder={t('googleWorkspace.applyMacro')} onChange={applyMailMacro}/>}<button type="button" className="gwp-save-macro-button" onClick={openMacroSaveDialog} disabled={!canSaveCurrentMailBody || isSending}>{t('googleWorkspace.saveMacro')}</button></div><div className="gwp-compose-actions"><div className="gwp-compose-attachment-actions"><button className="gwp-attachment-button" type="button" onClick={() => attachmentRef.current?.click()} disabled={isSending}><Paperclip aria-hidden="true" size={16}/><span>{t('googleWorkspace.attach')}</span></button><input ref={attachmentRef} type="file" multiple hidden disabled={isSending} onChange={event => addAttachments(event.target.files)}/>{attachments.length > 0 && <details ref={composeAttachmentDetailsRef} className="gwp-compose-attachment-summary"><summary aria-label={t('googleWorkspace.attachments', {count: attachments.length})}><Paperclip aria-hidden="true" size={16}/><strong>{attachments.length}</strong><small className={attachmentLimitExceeded ? 'gwp-attachment-limit-exceeded' : ''}>{formatAttachmentSize(attachmentBytes)} / 25 MB</small><ChevronUp className="gwp-attachment-summary-chevron" aria-hidden="true" size={15}/></summary><div className="gwp-compose-attachment-popover">{attachments.map((file, index) => { const name = isForwardedAttachment(file) ? file.filename : file.name; const key = isForwardedAttachment(file) ? `fwd-${file.id}-${index}` : `${file.name}-${file.lastModified}-${index}`; return <div className="gwp-compose-attachment-row" key={key}><span>{name}</span><small>{formatAttachmentSize(file.size)}</small><button type="button" aria-label={t('googleWorkspace.removeAttachment', {name})} onClick={() => removeAttachment(index)} disabled={isSending}>×</button></div>; })}</div></details>}</div><div className="gwp-compose-send-group"><button type="button" className="gwp-compose-cancel" onClick={closeCompose} disabled={aiGenerating || isSending}>{t('googleWorkspace.cancel')}</button><div className="gwp-ai-write-wrap">{aiPromptOpen && <div className="gwp-ai-prompt-popover">{aiGeneratedText && <div className="gwp-ai-generated-preview"><div className="gwp-ai-generated-preview-header"><strong>{t('googleWorkspace.aiGeneratedPreview')}</strong><button type="button" className="gwp-ai-prompt-insert" onClick={insertAiGeneratedBody} disabled={aiGenerating || isSending}>{t('googleWorkspace.aiInsert')}</button></div><pre>{aiGeneratedText}</pre></div>}<textarea value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} placeholder={getAiPlaceholder()} rows={3} disabled={aiGenerating || isSending} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); generateAiBody(); } }}/><div className="gwp-ai-prompt-actions"><button type="button" className="gwp-ai-prompt-cancel" onClick={() => { setAiPromptOpen(false); setAiGeneratedText(null); }} disabled={aiGenerating || isSending}>{t('googleWorkspace.close')}</button><button type="button" className="gwp-primary gwp-ai-prompt-generate" disabled={!aiPrompt.trim() || aiGenerating || isSending} onClick={generateAiBody}>{aiGenerating ? <><LoaderCircle aria-hidden="true" size={14} className="gwp-spin"/>{t('googleWorkspace.aiGenerating')}</> : t('googleWorkspace.aiGenerate')}</button></div></div>}<button type="button" className="gwp-ai-write-btn" onClick={() => { if (!aiPromptOpen && !aiPrompt) { const subject = originalMailForAi?.subject || ''; if (composeMode === 'reply') setAiPrompt(t('googleWorkspace.aiDefaultPromptReply', {subject})); else if (composeMode === 'forward') setAiPrompt(t('googleWorkspace.aiDefaultPromptForward', {subject})); } setAiPromptOpen(o => !o); }} disabled={aiGenerating || isSending}><Sparkles aria-hidden="true" size={15}/><span>{t('googleWorkspace.aiWrite')}</span></button></div><button className="gwp-primary gwp-compose-send" type="submit" disabled={!canSendMail || isSending || aiGenerating}>{isSending ? <LoaderCircle aria-hidden="true" size={16} className="gwp-spin"/> : t('googleWorkspace.send')}</button></div></div></form></div>}
        {isMacroSaveOpen && <ModalOverlay className="gwp-label-modal-overlay" onClose={() => setIsMacroSaveOpen(false)} closeOnBackdrop>
            <form className="gwp-label-modal" onSubmit={event => { event.preventDefault(); void saveCurrentBodyAsMacro(); }}>
                <header><h3>{t('googleWorkspace.saveCurrentBodyAsMacro')}</h3><button type="button" aria-label={t('googleWorkspace.close')} onClick={() => setIsMacroSaveOpen(false)}><X aria-hidden="true" size={20}/></button></header>
                <label><span>{t('googleWorkspace.macroTitlePlaceholder')}</span><input autoFocus value={macroSaveTitle} onChange={event => setMacroSaveTitle(event.target.value)} maxLength={100}/></label>
                <footer><button type="button" className="gwp-label-modal-cancel" onClick={() => setIsMacroSaveOpen(false)}>{t('googleWorkspace.cancel')}</button><button type="submit" className="gwp-primary" disabled={!macroSaveTitle.trim()}>{t('googleWorkspace.saveMacro')}</button></footer>
            </form>
        </ModalOverlay>}
        {signatureSettingsOpen && <ModalOverlay className="gwp-signature-settings-overlay" onClose={() => setSignatureSettingsOpen(false)} closeOnEscape={!signatureEditing && !macroDraft}>
            <section className="gwp-signature-settings" onClick={event => event.stopPropagation()}>
                <header><h3>{t('googleWorkspace.settings')}</h3><button type="button" aria-label={t('googleWorkspace.close')} onClick={() => setSignatureSettingsOpen(false)}>×</button></header>
                <div className="gwp-signature-settings-layout">
                    <nav className="gwp-signature-settings-nav"><button className={settingsSection === 'signature' ? 'active' : ''} type="button" onClick={() => setSettingsSection('signature')}><PenLine aria-hidden="true" size={18}/><span>{t('googleWorkspace.signature')}</span></button><button className={settingsSection === 'macros' ? 'active' : ''} type="button" onClick={() => setSettingsSection('macros')}><MessageSquarePlus aria-hidden="true" size={18}/><span>{t('googleWorkspace.mailMacros')}</span></button></nav>
                    <div className="gwp-signature-settings-content" data-section={settingsSection}>
                        <div className="gwp-signature-settings-intro"><div><h4>{t('googleWorkspace.signature')}</h4><p>{t('googleWorkspace.signatureDescription')}</p></div><button type="button" className={`gwp-signature-switch${signatureEnabled ? ' active' : ''}`} role="switch" aria-checked={signatureEnabled} aria-label={t('googleWorkspace.enableSignature')} onClick={() => void toggleMailSignature()}><span/></button></div>
                        <div className="gwp-signature-preview-section">
                            <div className="gwp-signature-preview-heading"><div><h5>{t('googleWorkspace.signaturePreview')}</h5><p>{t('googleWorkspace.signaturePreviewDescription')}</p></div>{!signatureEditing && <button type="button" className="gwp-signature-edit-button" onClick={() => setSignatureEditing(true)}>{t('googleWorkspace.edit')}</button>}</div>
                            {signatureEditing ? <div className="gwp-signature-editor"><EmailEditor ref={signatureEditorRef} content={signatureDraft} onChange={setSignatureDraft} placeholder={t('googleWorkspace.signaturePlaceholder')} inlineImages/><footer><CustomSelect className="gwp-signature-template-select" value={selectedSignatureTemplate} options={signatureTemplateOptions} placeholder={t('googleWorkspace.selectSignatureTemplate')} onChange={applySignatureTemplate} renderOption={option => <span className="gwp-signature-template-option"><i className={`is-${option.value}`} aria-hidden="true"/><span>{option.label}</span></span>}/><div><button type="button" className="gwp-signature-cancel" onClick={() => { setSignatureDraft(mailSignature); setSignatureEditing(false); }}>{t('googleWorkspace.cancel')}</button><button type="button" className="gwp-primary gwp-signature-save" onClick={() => void saveMailSignature()}>{t('googleWorkspace.saveSignature')}</button></div></footer></div> : <div className={`gwp-signature-preview${mailSignature ? '' : ' empty'}`} dangerouslySetInnerHTML={{__html: mailSignature || t('googleWorkspace.signaturePreviewEmpty')}}/>}
                        </div>
                        <div className={`gwp-mail-macros-section${macroDraft ? ' editing' : ''}`}>
                            {!macroDraft && <div className="gwp-mail-macros-header gwp-signature-preview-heading"><div><h5>{t('googleWorkspace.mailMacros')}</h5><p>{t('googleWorkspace.mailMacrosDescription')}</p></div><button type="button" className="gwp-signature-edit-button" onClick={() => setMacroDraft({id: crypto.randomUUID(), title: '', content_html: ''})}>{t('googleWorkspace.addMacro')}</button></div>}
                            {macroDraft && <div className="gwp-mail-macro-editor"><input value={macroDraft.title} maxLength={100} placeholder={t('googleWorkspace.macroTitlePlaceholder')} onChange={event => setMacroDraft(current => current ? {...current, title: event.target.value} : current)} onKeyDown={event => { if (event.key === 'Tab' && !event.shiftKey) { event.preventDefault(); macroEditorRef.current?.focus(); } }}/><EmailEditor ref={macroEditorRef} key={macroDraft.id} content={macroDraft.content_html} onChange={content_html => setMacroDraft(current => current ? {...current, content_html} : current)} placeholder={t('googleWorkspace.macroContentPlaceholder')}/><footer><button type="button" className="gwp-signature-cancel" onClick={() => setMacroDraft(null)}>{t('googleWorkspace.cancel')}</button><button type="button" className="gwp-primary gwp-signature-save" disabled={!macroDraft.title.trim()} onClick={() => void saveMacroDraft()}>{t('googleWorkspace.saveMacro')}</button></footer></div>}
                            {!macroDraft && <div className="gwp-mail-macro-list">{mailMacros.length ? mailMacros.map(macro => <div key={macro.id} draggable onDragStart={() => setDraggedMacroId(macro.id)} onDragOver={event => { event.preventDefault(); if (macro.id !== draggedMacroId) setDragOverMacroId(macro.id); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOverMacroId(current => current === macro.id ? null : current); }} onDrop={() => void reorderMailMacros(macro.id)} onDragEnd={() => { setDraggedMacroId(null); setDragOverMacroId(null); }} className={`${draggedMacroId === macro.id ? 'dragging' : ''}${dragOverMacroId === macro.id ? ' drag-over' : ''}`}><strong>{macro.title}</strong><span><button type="button" onClick={() => setMacroDraft(macro)}>{t('googleWorkspace.edit')}</button><button type="button" onClick={() => setMacroToDelete(macro)}>{t('googleWorkspace.delete')}</button></span></div>) : <p>{t('googleWorkspace.mailMacrosEmpty')}</p>}</div>}
                        </div>
                    </div>
                </div>
            </section>
        </ModalOverlay>}
        {macroToDelete && <ConfirmModal
            title={t('googleWorkspace.deleteMacroTitle', {name: macroToDelete.title})}
            description={t('googleWorkspace.deleteMacroDescription')}
            options={[
                {label: t('googleWorkspace.cancel'), value: 'cancel'},
                {label: t('googleWorkspace.delete'), value: 'delete', variant: 'danger'},
            ]}
            onSelect={value => {
                if (value === 'delete') void deleteMailMacro(macroToDelete.id);
                setMacroToDelete(null);
            }}
            onClose={() => setMacroToDelete(null)}
            actionLayout="horizontal"
        />}
        {sendFeedback && <div className={`gwp-send-feedback gwp-send-feedback--${sendFeedback}`} role="status">{sendFeedback === 'success' ? <CheckCircle2 aria-hidden="true" size={18}/> : <CircleAlert aria-hidden="true" size={18}/>}<span>{t(sendFeedback === 'success' ? 'googleWorkspace.mailSent' : 'googleWorkspace.mailSendFailed')}</span></div>}
        {(isOpeningMail || isRefreshingSentReply || isTrashingMails) && <div className="gwp-mail-activity" role="status"><LoaderCircle aria-hidden="true" size={18} className="gwp-spin"/><span>{isRefreshingSentReply ? t('googleWorkspace.loadingSentReply') : isOpeningMail ? t('googleWorkspace.loadingMail') : t('googleWorkspace.deletingSelectedMail')}</span></div>}
        {attachmentPreview?.mimeType.startsWith('image/') && attachmentPreview.url && createPortal(
            <ImageViewer images={[{src: attachmentPreview.url, alt: attachmentPreview.filename}]} currentIndex={0} onClose={closeAttachmentPreview} onIndexChange={() => {}}/>,
            document.body,
        )}
        {attachmentPreview && !attachmentPreview.mimeType.startsWith('image/') && <div className="gwp-attachment-preview-backdrop"><button className="gwp-attachment-preview-close" aria-label={t('googleWorkspace.closeAttachmentPreview')} onClick={closeAttachmentPreview}><X aria-hidden="true" size={24}/></button><section className="gwp-attachment-preview">{attachmentPreview.docx
            ? <DocxAttachmentPreview file={attachmentPreview.docx} label={attachmentPreview.filename}/>
            : <iframe aria-label={attachmentPreview.filename} src={attachmentPreview.url}/>}</section></div>}
    </>;
}

export default memo(MailPanel);
