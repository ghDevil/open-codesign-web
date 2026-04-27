// Re-export from snapshots-db so index.ts has one import location
export {
  listDesigns, getDesign, createDesign, renameDesign, setDesignThumbnail,
  softDeleteDesign, duplicateDesign, listSnapshots, getSnapshot, createSnapshot,
  deleteSnapshot, upsertDesignFile, listChatMessages, appendChatMessage,
  updateChatMessagePayload, normalizeDesignFilePath,
} from './snapshots-db.js';
