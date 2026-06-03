import { Box, Link, Typography } from "@mui/material";
import { useColorMode } from "../useColorMode";

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
                <strong>BCIT</strong>{" "}
                <Link
                    href="https://www.bcit.ca/learning-teaching-centre/"
                    target="_blank"
                    rel="noopener noreferrer"
                    color="text.secondary"
                    underline="hover"
                >
                    Teaching and Learning Unit
                </Link>
                <Box
                    component="span"
                    sx={{ display: "inline-block", width: "3ch" }}
                />
                <strong>Source code:</strong>{" "}
                <Link
                    href="https://www.mozilla.org/en-US/MPL/2.0/"
                    target="_blank"
                    rel="noopener noreferrer"
                    color="text.secondary"
                    underline="hover"
                >
                    MPL-2.0
                </Link>
                {canManageUsers &&
                    (() => {
                        // Versions are admin-only: the strings leak info
                        // about the deployed image and are not relevant
                        // to other roles.  Each component versions
                        // independently (see release-please packages in
                        // release-please-config.json) so the footer
                        // lists three distinct values rather than a
                        // single shared version.
                        const frontendVer = frontendVersion || "dev";
                        const releasesHref =
                            "https://github.com/bcit-tlu/hriv/releases";
                        const repoHref = "https://github.com/bcit-tlu/hriv";
                        const hrefFor = (v: string) =>
                            v && v !== "dev" ? releasesHref : repoHref;
                        return (
                            <>
                                <Box
                                    component="span"
                                    sx={{
                                        display: "inline-block",
                                        width: "3ch",
                                    }}
                                />
                                <strong>Frontend:</strong>{" "}
                                <Link
                                    href={hrefFor(frontendVer)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    color="text.secondary"
                                    underline="hover"
                                >
                                    {frontendVer}
                                </Link>
                                <Box
                                    component="span"
                                    sx={{
                                        display: "inline-block",
                                        width: "3ch",
                                    }}
                                />
                                <strong>Backend:</strong>{" "}
                                <Link
                                    href={hrefFor(backendVersion ?? "")}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    color="text.secondary"
                                    underline="hover"
                                >
                                    {backendVersion ?? "…"}
                                </Link>
                                <Box
                                    component="span"
                                    sx={{
                                        display: "inline-block",
                                        width: "3ch",
                                    }}
                                />
                                <strong>Backup:</strong>{" "}
                                <Link
                                    href={hrefFor(backupVersion ?? "")}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    color="text.secondary"
                                    underline="hover"
                                >
                                    {backupVersion ?? "…"}
                                </Link>
                            </>
                        );
                    })()}
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
