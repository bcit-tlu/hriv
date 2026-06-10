import { Box, Link, Typography } from "@mui/material";
import { useColorMode } from "../useColorMode";

const RELEASES_HREF = "https://github.com/bcit-tlu/hriv/releases";
const REPO_HREF = "https://github.com/bcit-tlu/hriv";

function Spacer() {
    return (
        <Box component="span" sx={{ display: "inline-block", width: "3ch" }} />
    );
}

function hrefFor(version: string) {
    return version && version !== "dev" ? RELEASES_HREF : REPO_HREF;
}

function AdminVersions({
    frontendVersion,
    backendVersion,
    backupVersion,
}: {
    frontendVersion?: string;
    backendVersion?: string;
    backupVersion?: string;
}) {
    const entries = [
        {
            label: "Frontend",
            display: frontendVersion || "dev",
            linkValue: frontendVersion || "dev",
        },
        {
            label: "Backend",
            display: backendVersion ?? "…",
            linkValue: backendVersion ?? "",
        },
        {
            label: "Backup",
            display: backupVersion ?? "…",
            linkValue: backupVersion ?? "",
        },
    ];

    return (
        <>
            {entries.map(({ label, display, linkValue }) => (
                <span key={label}>
                    <Spacer />
                    <strong>{label}:</strong>{" "}
                    <Link
                        href={hrefFor(linkValue)}
                        target="_blank"
                        rel="noopener noreferrer"
                        color="text.secondary"
                        underline="hover"
                    >
                        {display}
                    </Link>
                </span>
            ))}
        </>
    );
}

export interface FooterBarProps {
    canManageUsers: boolean;
    frontendVersion?: string;
    backendVersion?: string;
    backupVersion?: string;
    onReportIssue?: () => void;
}

export default function FooterBar({
    canManageUsers,
    frontendVersion,
    backendVersion,
    backupVersion,
    onReportIssue,
}: FooterBarProps) {
    const { mode } = useColorMode();

    return (
        <Box
            component="footer"
            sx={{
                py: 1,
                px: 2,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                bgcolor:
                    mode === "dark" ? "background.paper" : "background.default",
                borderTop: 1,
                borderColor: "divider",
                flex: "0 0 auto",
            }}
        >
            <Typography variant="caption" color="text.secondary">
                <Link
                    href={REPO_HREF}
                    target="_blank"
                    rel="noopener noreferrer"
                    color="text.secondary"
                    underline="hover"
                >
                    High Resolution Image Viewer
                </Link>
                {canManageUsers && (
                    <AdminVersions
                        frontendVersion={frontendVersion}
                        backendVersion={backendVersion}
                        backupVersion={backupVersion}
                    />
                )}
            </Typography>
            {onReportIssue && (
                <Link
                    component="button"
                    variant="caption"
                    color="text.secondary"
                    underline="hover"
                    onClick={onReportIssue}
                    sx={{ cursor: "pointer" }}
                >
                    Report issue
                </Link>
            )}
        </Box>
    );
}
