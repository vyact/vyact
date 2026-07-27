/**
 * Shared rich-text image extensions used by memo and email editors.
 *
 * The node implementation remains colocated with the attachment node during
 * the transition because persisted documents use the `memoImage` node name.
 */
export {
    MEMO_IMAGE_INITIAL_HEIGHT as RICH_TEXT_IMAGE_INITIAL_HEIGHT,
    MemoImage as RichTextImage,
    MemoImageLayout as RichTextImageLayout,
} from '../../MemoModal/MemoAttachmentNodes';
