const prisma = require('../config/prisma');
const ApiError = require('../utils/ApiError');
const { resolveFeatures } = require('../domain/features');
const { KEEP_CHATS_DAYS, MAX_NOTES, MAX_NOTE_LENGTH } = require('../constants/assistant');

// "Remember assistant chats" (Settings › Features, off by default): the conversation and
// the assistant's notes, on the account so the phone and the web carry on together.
// Nothing is kept while it's off, and switching it off deletes what was kept.

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const keepCutoff = () => new Date(Date.now() - KEEP_CHATS_DAYS * DAY_MS);

const noteFields = { id: true, text: true, createdAt: true };

/** Whether they keep chats, and whether they ever chose (the app asks once). */
const choiceOf = async (userId) => {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { features: true } });
    if (!user) throw new ApiError(401, 'User no longer exists');
    const stored = user.features && typeof user.features === 'object' ? user.features : {};
    return { remember: resolveFeatures(stored).rememberChats, decided: typeof stored.rememberChats === 'boolean' };
};

/** GET /assistant/memory: the choice, and while it's on, the conversation and the notes. */
const getMemory = async (userId) => {
    const choice = await choiceOf(userId);
    if (!choice.remember) return { ...choice, messages: [], notes: [] };
    const [conversation, notes] = await Promise.all([
        prisma.assistantConversation.findUnique({ where: { userId }, select: { messages: true, updatedAt: true } }),
        listNotes(userId),
    ]);
    // Past its keeping time but not purged yet: as good as gone
    const fresh = conversation && conversation.updatedAt > keepCutoff();
    return { ...choice, messages: fresh ? conversation.messages : [], notes };
};

/** PUT /assistant/memory/conversation: the recent conversation replaces what was kept. */
const keepConversation = async (userId, messages) => {
    const { remember } = await choiceOf(userId);
    if (!remember) throw new ApiError(409, 'Remembering chats is switched off', { code: 'MEMORY_OFF' });
    if (messages.length === 0) {
        await prisma.assistantConversation.deleteMany({ where: { userId } });
        return;
    }
    await prisma.assistantConversation.upsert({ where: { userId }, create: { userId, messages }, update: { messages } });
};

/** DELETE /assistant/memory, and switching the feature off: every kept word goes. */
const forgetAll = async (userId) => {
    await prisma.$transaction([prisma.assistantConversation.deleteMany({ where: { userId } }), prisma.assistantNote.deleteMany({ where: { userId } })]);
};

const listNotes = (userId) => prisma.assistantNote.findMany({ where: { userId }, select: noteFields, orderBy: { createdAt: 'asc' } });

/**
 * The assistant's remember_note. The same note twice is kept once; past MAX_NOTES the
 * oldest makes room. Throws a plain Error the model can read when there's nothing to keep.
 */
const addNote = async (userId, text) => {
    const note = String(text ?? '').trim().slice(0, MAX_NOTE_LENGTH);
    if (!note) throw new Error('Nothing to remember — give the note text');
    const notes = await listNotes(userId);
    if (notes.some((existing) => existing.text.toLowerCase() === note.toLowerCase())) return;
    const overflow = notes.slice(0, Math.max(0, notes.length - MAX_NOTES + 1));
    await prisma.$transaction([
        ...(overflow.length ? [prisma.assistantNote.deleteMany({ where: { userId, id: { in: overflow.map((item) => item.id) } } })] : []),
        prisma.assistantNote.create({ data: { userId, text: note } }),
    ]);
};

/** DELETE /assistant/memory/notes/:noteId — not theirs is 404, like everything else. */
const deleteNote = async (userId, noteId) => {
    const { count } = await prisma.assistantNote.deleteMany({ where: { id: noteId, userId } });
    if (!count) throw new ApiError(404, 'Note not found');
};

/** Conversations untouched for KEEP_CHATS_DAYS are deleted. Notes stay until they're deleted or the feature goes off. */
const purgeOldConversations = async () => {
    const { count } = await prisma.assistantConversation.deleteMany({ where: { updatedAt: { lt: keepCutoff() } } });
    if (count) console.log(`🗑️  Deleted ${count} assistant conversation(s) older than ${KEEP_CHATS_DAYS} days`);
    return count;
};

/** At start and every hour; safe with several servers (deleting what's gone deletes nothing). */
const scheduleConversationPurge = () => {
    const run = () => purgeOldConversations().catch((err) => console.error('Assistant conversation purge failed:', err.message));
    run();
    setInterval(run, HOUR_MS).unref();
};

module.exports = { getMemory, keepConversation, forgetAll, listNotes, addNote, deleteNote, purgeOldConversations, scheduleConversationPurge };
