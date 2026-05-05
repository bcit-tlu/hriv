import { useState, useEffect, useRef } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import { fetchStatus } from "../api";

const POLL_INTERVAL_MS = 10_000;

interface MaintenanceBannerProps {
    children: React.ReactNode;
}

export default function MaintenanceBanner({ children }: MaintenanceBannerProps) {
    const [maintenance, setMaintenance] = useState(false);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        let cancelled = false;

        const check = async () => {
            try {
                const status = await fetchStatus();
                if (!cancelled) setMaintenance(status.maintenance);
            } catch {
                // Backend unreachable — assume not in maintenance so
                // normal error handling (auth/network) can kick in.
            }
        };

        check();
        timerRef.current = setInterval(check, POLL_INTERVAL_MS);

        return () => {
            cancelled = true;
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, []);

    if (!maintenance) return <>{children}</>;

    return (
        <Box
            sx={{
                minHeight: "100vh",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                bgcolor: "background.default",
                textAlign: "center",
                px: 3,
            }}
        >
            <CircularProgress size={48} sx={{ mb: 3 }} />
            <Typography variant="h5" gutterBottom>
                Maintenance in Progress
            </Typography>
            <Typography variant="body1" color="text.secondary">
                The application is being restored from a backup.
                This page will refresh automatically when maintenance is complete.
            </Typography>
        </Box>
    );
}
