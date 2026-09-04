export function splitSpeechBuffer(text: string, final = false): {sentences: string[]; rest: string} {
    const sentences: string[] = [];
    let end = 0;
    // Wait for punctuation plus whitespace, so decimal points and partial tokens stay intact.
    const boundary = /[.!?](?:["'”’)]*)\s+|[。！？]|\n+/g;
    for (const match of text.matchAll(boundary)) {
        const next = match.index! + match[0].length;
        sentences.push(text.slice(end, next));
        end = next;
    }
    if (final && text.slice(end).trim()) { sentences.push(text.slice(end)); end = text.length; }
    return {sentences, rest: text.slice(end)};
}

