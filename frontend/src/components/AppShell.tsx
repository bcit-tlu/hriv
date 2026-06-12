import { useEffect, useState, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from "react";
import Alert from "@mui/material/Alert";
import AppBar from "@mui/material/AppBar";
import Avatar from "@mui/material/Avatar";
import Box from "@mui/material/Box";
import Collapse from "@mui/material/Collapse";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Link from "@mui/material/Link";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Popover from "@mui/material/Popover";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import Toolbar from "@mui/material/Toolbar";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import SearchIcon from "@mui/icons-material/Search";
import ColorModeToggle from "./ColorModeToggle";
import AnnouncementBanner from "./AnnouncementBanner";
import type { Role } from "../types";
import { getSurfaceVariant } from "../theme";

export type Page = "browse" | "manage" | "people" | "admin";

export interface AppShellProps {
    page: Page;
    onTabChange: (page: Page) => void;
    onHomeClick: () => void;
    canEditContent: boolean;
    canManageUsers: boolean;
    currentUser: { name: string; email: string; role: Role; program_names: string[]; group_names: string[] };
    announcement: string;
    annMessage: string;
    annEnabled: boolean;
    onDismissAnnouncement?: () => void;
    // Profile popover
    profileOpen: boolean;
    setProfileOpen: Dispatch<SetStateAction<boolean>>;
    avatarRef: RefObject<HTMLButtonElement | null>;
    openEditProfile: () => void;
    logout: () => void;
    // Manage menu
    onOpenCategories: () => void;
    onOpenPrograms: () => void;
    onOpenGroups: () => void;
    onOpenAnnouncement: () => void;
    // Search
    onSearchOpen: () => void;
    // Footer
    mode: "light" | "dark";
    frontendVersion: string | null;
    backendVersion: string | null;
    backupVersion: string | null;
    onReportIssue: () => void;
    // Children (main content)
    children: ReactNode;
}

export default function AppShell(props: AppShellProps) {
    const {
        page,
        onTabChange,
        onHomeClick,
        canEditContent,
        canManageUsers,
        currentUser,
        announcement,
        annMessage,
        annEnabled,
        onDismissAnnouncement,
        profileOpen,
        setProfileOpen,
        avatarRef,
        openEditProfile,
        logout,
        onOpenCategories,
        onOpenPrograms,
        onOpenGroups,
        onOpenAnnouncement,
        onSearchOpen,
        mode,
        frontendVersion,
        backendVersion,
        backupVersion,
        onReportIssue,
        children,
    } = props;
    const [manageMenuAnchor, setManageMenuAnchor] =
        useState<HTMLElement | null>(null);
    const [viewAnnOpen, setViewAnnOpen] = useState(false);
    const [annCollapsed, setAnnCollapsed] = useState(false);
    const showViewAnnLink = annEnabled && !announcement;
    const contentBg =
        page === "people" || page === "admin"
            ? getSurfaceVariant(mode)
            : undefined;

    useEffect(() => {
        if (announcement) setAnnCollapsed(false);
    }, [announcement]);

    return (
        <Box
            sx={{
                display: "flex",
                flexDirection: "column",
                minHeight: "100vh",
            }}
        >
            {/* App bar */}
            <AppBar position="static" elevation={1}>
                <Toolbar>
                    <Box
                        sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 1,
                            mr: 2,
                        }}
                    >
                        <Box
                            component="img"
                            src="/favicon.svg"
                            alt="HRIV"
                            sx={{ height: 32, width: 32 }}
                        />
                        <Typography variant="h6" component="h1">
                            HRIV
                        </Typography>
                    </Box>
                    <Tabs
                        value={page}
                        onChange={(_, v: Page) => {
                            if (
                                v === "browse" ||
                                v === "manage" ||
                                v === "people" ||
                                v === "admin"
                            ) {
                                onTabChange(v);
                            }
                        }}
                        textColor="inherit"
                        TabIndicatorProps={{
                            style: { backgroundColor: "white" },
                        }}
                        sx={{ flexGrow: 1 }}
                    >
                        <Tab
                            label="Home"
                            value="browse"
                            onClick={() => {
                                // Only fire when already on browse (refresh/reset);
                                // otherwise Tabs onChange handles the page switch.
                                if (page === "browse") {
                                    onHomeClick();
                                }
                            }}
                        />
                        {canEditContent && (
                            <Tab label="Images" value="manage" />
                        )}
                        {canEditContent && (
                            <Tab
                                label="Manage"
                                value={false}
                                onClick={(e) =>
                                    setManageMenuAnchor(e.currentTarget)
                                }
                            />
                        )}
                        {canManageUsers && (
                            <Tab label="People" value="people" />
                        )}
                        {canManageUsers && <Tab label="Admin" value="admin" />}
                    </Tabs>
                    <Menu
                        anchorEl={manageMenuAnchor}
                        open={Boolean(manageMenuAnchor)}
                        onClose={() => setManageMenuAnchor(null)}
                    >
                        <MenuItem
                            onClick={() => {
                                setManageMenuAnchor(null);
                                onOpenCategories();
                            }}
                        >
                            Categories
                        </MenuItem>
                        {canManageUsers && (
                            <MenuItem
                                onClick={() => {
                                    setManageMenuAnchor(null);
                                    onOpenPrograms();
                                }}
                            >
                                Programs
                            </MenuItem>
                        )}
                        <MenuItem
                            onClick={() => {
                                setManageMenuAnchor(null);
                                onOpenGroups();
                            }}
                        >
                            Groups
                        </MenuItem>
                        <MenuItem
                            onClick={() => {
                                setManageMenuAnchor(null);
                                onOpenAnnouncement();
                            }}
                        >
                            Announcement
                        </MenuItem>
                    </Menu>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                        <ColorModeToggle iconButtonSx={{ color: "inherit" }} />
                        <Tooltip title="Search">
                            <IconButton
                                onClick={onSearchOpen}
                                sx={{ color: "inherit" }}
                                aria-label="Search"
                            >
                                <SearchIcon />
                            </IconButton>
                        </Tooltip>
                        <IconButton
                            ref={avatarRef}
                            onClick={() => setProfileOpen(true)}
                            sx={{ p: 0 }}
                        >
                            <Avatar
                                sx={{
                                    width: 34,
                                    height: 34,
                                    fontSize: 14,
                                    bgcolor: "rgba(255,255,255,0.25)",
                                    color: "white",
                                }}
                            >
                                {currentUser.name
                                    .split(" ")
                                    .map((w) => w[0])
                                    .join("")
                                    .toUpperCase()
                                    .slice(0, 2)}
                            </Avatar>
                        </IconButton>
                        <Popover
                            open={profileOpen}
                            anchorEl={avatarRef.current}
                            onClose={() => setProfileOpen(false)}
                            anchorOrigin={{
                                vertical: "bottom",
                                horizontal: "right",
                            }}
                            transformOrigin={{
                                vertical: "top",
                                horizontal: "right",
                            }}
                        >
                            <Card sx={{ minWidth: 240 }}>
                                <CardContent>
                                    <Typography
                                        variant="subtitle1"
                                        sx={{ fontWeight: 600 }}
                                    >
                                        {currentUser.name}
                                    </Typography>
                                    <Typography
                                        variant="body2"
                                        color="text.secondary"
                                    >
                                        {currentUser.email}
                                    </Typography>
                                    <Typography
                                        variant="body2"
                                        color="text.secondary"
                                        sx={{ textTransform: "capitalize" }}
                                    >
                                        {currentUser.role}
                                    </Typography>
                                    {currentUser.program_names.length > 0 && (
                                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                                            {currentUser.program_names.map((name) => (
                                                <Chip key={name} label={name} size="small" color="primary" />
                                            ))}
                                        </Box>
                                    )}
                                    {currentUser.group_names.length > 0 && (
                                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                                            {currentUser.group_names.map((name) => (
                                                <Chip
                                                    key={name}
                                                    label={name}
                                                    size="small"
                                                    color="secondary"
                                                />
                                            ))}
                                        </Box>
                                    )}
                                    <Box
                                        sx={{
                                            display: "flex",
                                            justifyContent: canManageUsers || showViewAnnLink
                                                ? "space-between"
                                                : "flex-end",
                                            mt: 2,
                                            gap: 2,
                                            flexWrap: "wrap",
                                        }}
                                    >
                                        <Box sx={{ display: "flex", gap: 2 }}>
                                            {canManageUsers && (
                                                <Link
                                                    component="button"
                                                    variant="body2"
                                                    onClick={() => {
                                                        openEditProfile();
                                                    }}
                                                >
                                                    Update
                                                </Link>
                                            )}
                                            {showViewAnnLink && (
                                                <Link
                                                    component="button"
                                                    variant="body2"
                                                    onClick={() => {
                                                        setProfileOpen(false);
                                                        setViewAnnOpen(true);
                                                    }}
                                                >
                                                    View Announcement
                                                </Link>
                                            )}
                                        </Box>
                                        <Link
                                            component="button"
                                            variant="body2"
                                            color="primary"
                                            onClick={() => {
                                                setProfileOpen(false);
                                                logout();
                                            }}
                                        >
                                            Logout
                                        </Link>
                                    </Box>
                                </CardContent>
                            </Card>
                        </Popover>
                    </Box>
                </Toolbar>
            </AppBar>

            {/* Announcement banner */}
            {announcement && (
                <Collapse in={!annCollapsed} onExited={onDismissAnnouncement}>
                    <Box
                        sx={{
                            bgcolor: contentBg,
                            pt: "20px",
                        }}
                    >
                        <Box sx={{ mx: "10%", mb: 0 }}>
                            <AnnouncementBanner
                                message={announcement}
                                onDismiss={onDismissAnnouncement ? () => setAnnCollapsed(true) : undefined}
                            />
                        </Box>
                    </Box>
                </Collapse>
            )}

            {/* Read-only announcement dialog (for dismissed announcements) */}
            <Dialog open={viewAnnOpen} onClose={() => setViewAnnOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Announcement</DialogTitle>
                <DialogContent>
                    <Alert severity="info" sx={{ mt: 1 }}>{annMessage}</Alert>
                </DialogContent>
            </Dialog>

            {/* Main content */}
            {children}

            {/* Footer */}
            <Box
                component="footer"
                sx={{
                    py: 1,
                    px: 2,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    bgcolor:
                        mode === "dark"
                            ? "background.paper"
                            : "background.default",
                    borderTop: 1,
                    borderColor: "divider",
                }}
            >
                <Typography variant="caption" color="text.secondary">
                    <Link
                        href="https://github.com/bcit-tlu/hriv"
                        target="_blank"
                        rel="noopener noreferrer"
                        color="text.secondary"
                        underline="hover"
                    >
                        High Resolution Image Viewer
                    </Link>
                    {canManageUsers &&
                        (() => {
                            const frontendVer = frontendVersion || "dev";
                            const releasesHref =
                                "https://github.com/bcit-tlu/hriv/releases";
                            const repoHref =
                                "https://github.com/bcit-tlu/hriv";
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
            </Box>
        </Box>
    );
}
