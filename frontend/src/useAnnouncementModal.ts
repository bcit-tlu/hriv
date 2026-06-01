import { useState, useCallback, useEffect } from "react";
import { fetchAnnouncement, updateAnnouncement, userMessage } from "./api";

export function useAnnouncementModal() {
    const [announcement, setAnnouncement] = useState("");
    const [annModalOpen, setAnnModalOpen] = useState(false);
    const [annMessage, setAnnMessage] = useState("");
    const [annEnabled, setAnnEnabled] = useState(false);
    const [annDraftMessage, setAnnDraftMessage] = useState("");
    const [annDraftEnabled, setAnnDraftEnabled] = useState(false);
    const [annSaving, setAnnSaving] = useState(false);
    const [annError, setAnnError] = useState<string | null>(null);

    const loadAnnouncement = useCallback(async () => {
        try {
            const ann = await fetchAnnouncement();
            setAnnouncement(ann.enabled ? ann.message : "");
            setAnnMessage(ann.message);
            setAnnEnabled(ann.enabled);
        } catch {
            // Silently ignore — announcement is non-critical
        }
    }, []);

    useEffect(() => {
        loadAnnouncement();
    }, [loadAnnouncement]);

    const openAnnModal = useCallback(() => {
        setAnnDraftMessage(annMessage);
        setAnnDraftEnabled(annEnabled);
        setAnnError(null);
        setAnnModalOpen(true);
    }, [annMessage, annEnabled]);

    const handleAnnSave = useCallback(async () => {
        setAnnSaving(true);
        try {
            const updated = await updateAnnouncement({
                message: annDraftMessage,
                enabled: annDraftEnabled,
            });
            setAnnMessage(updated.message);
            setAnnEnabled(updated.enabled);
            setAnnouncement(updated.enabled ? updated.message : "");
            setAnnModalOpen(false);
        } catch (err) {
            setAnnError(userMessage(err, "Failed to update announcement"));
        } finally {
            setAnnSaving(false);
        }
    }, [annDraftMessage, annDraftEnabled]);

    return {
        announcement,
        annModalOpen,
        setAnnModalOpen,
        annDraftMessage,
        setAnnDraftMessage,
        annDraftEnabled,
        setAnnDraftEnabled,
        annSaving,
        annError,
        setAnnError,
        openAnnModal,
        handleAnnSave,
    };
}
