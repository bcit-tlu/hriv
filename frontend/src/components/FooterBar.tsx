import { Box, Link, Typography } from "@mui/material";
import { useColorMode } from "../useColorMode";

// A fixed-width inline gap used to separate footer items. Pulled out so the
// spacing stays consistent across the base and admin sections.
function Spacer() {
    return (
        <Box component="span" sx={{ display: "inline-block", width: "3ch" }} />
    );
}

const RELEASES_HREF = "https://github.com/bcit-tlu/hriv/releases";
const REPO_HREF = "https://github.com/bcit-tlu/hriv";

// Real versions link to the tagged releases page; "dev"/unknown builds have
// no matching release, so they fall back to the repository root.
const hrefFor = (version: string) =>
    version && version !== "dev" ? RELEASES_HREF : REPO_HREF;

/**
 * Admin-only version footer.
 *
 * Versions are admin-only: the strings leak info about the deployed image and
 * are not relevant to other roles. Each component versions independently (see
 * release-please packages in release-please-config.json) so the footer lists
 * three distinct values rather than a single shared version.
 *
 * `display` is what the user sees; `linkValue` is what drives `hrefFor` — they
 * differ when a version is missing (we show a "…" placeholder but resolve the
 * link from an empty string, i.e. the repo root).
 */
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

function FooterBar({
    canManageUsers,
    frontendVersion,
    backendVersion,
    backupVersion,
    setReportIssueOpen,
}: {
    canManageUsers: boolean;
    frontendVersion?: string;
    backendVersion?: string;
    backupVersion?: string;
    setReportIssueOpen?: (open: boolean) => void;
}) {
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
            {setReportIssueOpen && (
                <Link
                    component="button"
                    variant="caption"
                    color="text.secondary"
                    underline="hover"
                    onClick={() => setReportIssueOpen(true)}
                    sx={{ cursor: "pointer" }}
                >
                    Report issue
                </Link>
            )}
        </Box>
    );
}

export default FooterBar;
