import { useState, useEffect } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import Link from "@mui/material/Link";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import Visibility from "@mui/icons-material/Visibility";
import VisibilityOff from "@mui/icons-material/VisibilityOff";
import AnnouncementBanner from "./AnnouncementBanner";
import ColorModeToggle from "./ColorModeToggle";
import { fetchOidcEnabled, getOidcLoginUrl } from "../api";
import { useAuth } from "../useAuth";

interface LoginScreenProps {
    onLogin: (email: string, password: string) => Promise<void>;
    announcement?: string;
}

// Map short, stable error codes returned by the backend OIDC callback
// to user-facing messages. Keep the set in sync with the constants in
// ``backend/app/routers/oidc.py``. Unknown codes fall through to a
// generic message so a future backend addition never leaves the user
// with a blank alert.
const OIDC_ERROR_MESSAGES: Record<string, string> = {
    client_misconfigured:
        "Single sign-on is misconfigured. Please contact an administrator.",
    provider_unreachable:
        "The identity provider is currently unreachable. Please try again in a moment.",
    token_exchange_failed:
        "We couldn't complete sign-in with the identity provider. Please try again.",
    userinfo_failed:
        "We couldn't read your profile from the identity provider. Please try again.",
    missing_claims:
        "Your account is missing required information from the identity provider. Please contact an administrator.",
    subject_mismatch:
        "This email is already linked to a different identity. Please contact an administrator.",
};

export default function LoginScreen({
    onLogin,
    announcement,
}: LoginScreenProps) {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [oidcEnabled, setOidcEnabled] = useState(false);
    const [showLocalForm, setShowLocalForm] = useState(false);
    const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false);
    const { oidcError, clearOidcError } = useAuth();

    useEffect(() => {
        fetchOidcEnabled()
            .then((res) => setOidcEnabled(res.enabled))
            .catch(() => setOidcEnabled(false));
    }, []);

    const oidcErrorMessage = oidcError
        ? (OIDC_ERROR_MESSAGES[oidcError] ??
          "Sign-in failed. Please try again.")
        : null;

    const handleOidcLogin = () => {
        window.location.href = getOidcLoginUrl();
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);
        try {
            await onLogin(email, password);
        } catch (err) {
            console.error(
                "Login error:",
                err instanceof Error ? err.message : err,
            );
            setError("Incorrect email or password");
        } finally {
            setLoading(false);
        }
    };

    // When OIDC is enabled and the local form is not toggled, show only the
    // OIDC button + a "Use a local user" link (Rancher-style).
    const showOidcDefault = oidcEnabled && !showLocalForm;

    return (
        <Box
            sx={{
                minHeight: "100vh",
                display: "flex",
                bgcolor: "background.paper",
                position: "relative",
            }}
        >
            {/* Theme toggle (Light / Dark / Auto) */}
            <Box
                sx={{
                    position: "absolute",
                    top: 16,
                    right: 16,
                    zIndex: 1,
                }}
            >
                <ColorModeToggle
                    iconButtonSx={{ color: "text.secondary" }}
                />
            </Box>

            {/* Left side — form */}
            <Box
                sx={{
                    flex: "0 0 50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    px: { xs: 3, sm: 6, md: 8 },
                }}
            >
                <Box sx={{ width: "100%", maxWidth: 400 }}>
                    {announcement && (
                        <AnnouncementBanner
                            message={announcement}
                            variant="login"
                        />
                    )}

                    {/* BCIT logo + Login heading */}
                    <Box
                        sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 1.5,
                            mb: 5,
                        }}
                    >
                        <Box
                            component="img"
                            src="/bcit-logo.svg"
                            alt="BCIT"
                            sx={{ height: 48 }}
                        />
                        <Typography variant="h5" sx={{ fontWeight: 400 }}>
                            High Resolution Image Viewer (HRIV) Login
                        </Typography>
                    </Box>

                    {oidcErrorMessage && (
                        <Alert
                            severity="error"
                            onClose={clearOidcError}
                            sx={{ mb: 2 }}
                        >
                            {oidcErrorMessage}
                        </Alert>
                    )}

                    {showOidcDefault ? (
                        /* ── OIDC-primary view ─────────────────── */
                        <Box
                            sx={{
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                gap: 2,
                            }}
                        >
                            <Button
                                variant="contained"
                                fullWidth
                                onClick={handleOidcLogin}
                                sx={{
                                    textTransform: "none",
                                    fontWeight: 600,
                                    py: 1.25,
                                    fontSize: "0.95rem",
                                }}
                            >
                                Sign in with BCIT
                            </Button>
                            <Link
                                component="button"
                                variant="body2"
                                underline="hover"
                                onClick={() => setShowLocalForm(true)}
                            >
                                Use a local user
                            </Link>
                        </Box>
                    ) : (
                        /* ── Local-credentials view ────────────── */
                        <Box
                            component="form"
                            onSubmit={handleSubmit}
                            sx={{
                                display: "flex",
                                flexDirection: "column",
                                gap: 3,
                            }}
                        >
                            {error && (
                                <Alert
                                    severity="error"
                                    onClose={() => setError(null)}
                                >
                                    {error}
                                </Alert>
                            )}

                            <TextField
                                label="Username"
                                placeholder="username@bcit.ca"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                fullWidth
                                autoFocus
                                autoComplete="email"
                                variant="standard"
                            />

                            <TextField
                                label="Password"
                                placeholder="Password"
                                type={showPassword ? "text" : "password"}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                                fullWidth
                                autoComplete="current-password"
                                variant="standard"
                                slotProps={{
                                    input: {
                                        endAdornment: (
                                            <InputAdornment position="end">
                                                <IconButton
                                                    aria-label="toggle password visibility"
                                                    onClick={() =>
                                                        setShowPassword(
                                                            (prev) => !prev,
                                                        )
                                                    }
                                                    edge="end"
                                                    size="small"
                                                >
                                                    {showPassword ? (
                                                        <VisibilityOff />
                                                    ) : (
                                                        <Visibility />
                                                    )}
                                                </IconButton>
                                            </InputAdornment>
                                        ),
                                    },
                                }}
                            />

                            <Box
                                sx={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                }}
                            >
                                <Button
                                    type="button"
                                    variant="text"
                                    onClick={() => setForgotPasswordOpen(true)}
                                    sx={{
                                        px: 0,
                                        fontWeight: 600,
                                        letterSpacing: 1,
                                        color: "text.disabled",
                                    }}
                                >
                                    Forgot Password?
                                </Button>
                                <Button
                                    type="submit"
                                    variant="text"
                                    disabled={loading || !email || !password}
                                    startIcon={
                                        loading ? (
                                            <CircularProgress
                                                size={18}
                                                color="inherit"
                                            />
                                        ) : undefined
                                    }
                                    sx={{ fontWeight: 600, letterSpacing: 1 }}
                                >
                                    {loading ? "Signing in..." : "LOGIN"}
                                </Button>
                            </Box>

                            {oidcEnabled && (
                                <Box sx={{ textAlign: "center", mt: 1 }}>
                                    <Link
                                        component="button"
                                        type="button"
                                        variant="body2"
                                        underline="hover"
                                        onClick={() => setShowLocalForm(false)}
                                    >
                                        Sign in with BCIT
                                    </Link>
                                </Box>
                            )}
                        </Box>
                    )}
                </Box>
            </Box>

            <Dialog
                open={forgotPasswordOpen}
                onClose={() => setForgotPasswordOpen(false)}
                aria-labelledby="forgot-password-dialog-title"
            >
                <DialogTitle id="forgot-password-dialog-title">
                    Forgot Password
                </DialogTitle>
                <DialogContent>
                    <Typography>
                        Please contact the TLU Lab via Teams to reset your
                        password.
                    </Typography>
                </DialogContent>
            </Dialog>

            {/* Right side — splash image */}
            <Box
                sx={{
                    flex: "0 0 50%",
                    backgroundImage: "url(/hriv-splash2.jpg)",
                    backgroundSize: "cover",
                    backgroundPosition: "center",
                    display: { xs: "none", md: "block" },
                }}
            />
        </Box>
    );
}
