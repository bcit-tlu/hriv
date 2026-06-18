import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardMedia from "@mui/material/CardMedia";
import CardContent from "@mui/material/CardContent";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import EditIcon from "@mui/icons-material/Edit";
import VisibilityOff from "@mui/icons-material/VisibilityOff";
import Visibility from "@mui/icons-material/Visibility";
import type { ImageItem } from "../types";
import { useColorMode } from "../useColorMode";
import { getVisibilityColors } from "../theme";

interface ImageTileProps {
    image: ImageItem;
    onClick: (image: ImageItem) => void;
    onEditDetails?: (image: ImageItem) => void;
    onToggleVisibility?: (imageId: number) => Promise<void>;
    categoryHidden?: boolean;
}

export default function ImageTile({
    image,
    onClick,
    onEditDetails,
    onToggleVisibility,
    categoryHidden = false,
}: ImageTileProps) {
    const { mode } = useColorMode();
    const visColors = getVisibilityColors(mode);
    const desaturated = !image.active || categoryHidden;
    return (
        <Card
            elevation={2}
            sx={{
                width: "100%",
                maxWidth: 300,
                position: "relative",
                opacity: categoryHidden ? 0.5 : 1,
            }}
        >
            <Box
                sx={{
                    position: "absolute",
                    top: 4,
                    right: 4,
                    zIndex: 1,
                    display: "flex",
                    gap: 0.5,
                }}
            >
                {onToggleVisibility && (
                    <Tooltip
                        title={
                            image.active
                                ? "Visibility: Hide from students"
                                : "Visibility: Show to students"
                        }
                    >
                        <IconButton
                            size="small"
                            sx={{
                                color: "white",
                                bgcolor: "rgba(0,0,0,0.25)",
                                "&:hover": { bgcolor: "rgba(0,0,0,0.45)" },
                            }}
                            onClick={(e) => {
                                e.stopPropagation();
                                onToggleVisibility(image.id);
                            }}
                            aria-label={
                                image.active
                                    ? "Visibility: Hide from students"
                                    : "Visibility: Show to students"
                            }
                        >
                            {image.active ? (
                                <Visibility fontSize="small" />
                            ) : (
                                <VisibilityOff fontSize="small" />
                            )}
                        </IconButton>
                    </Tooltip>
                )}
                {onEditDetails && (
                    <Tooltip title="Edit image details">
                        <IconButton
                            size="small"
                            sx={{
                                color: "white",
                                bgcolor: "rgba(0,0,0,0.25)",
                                "&:hover": { bgcolor: "rgba(0,0,0,0.45)" },
                            }}
                            onClick={(e) => {
                                e.stopPropagation();
                                onEditDetails(image);
                            }}
                            aria-label="Edit image details"
                        >
                            <EditIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                    </Tooltip>
                )}
            </Box>
            <CardActionArea
                onClick={() => onClick(image)}
                sx={{
                    display: "flex",
                    flexDirection: "column",
                    height: "100%",
                    alignItems: "stretch",
                    filter: desaturated ? "grayscale(100%)" : "none",
                }}
            >
                <CardMedia
                    component="img"
                    height="160"
                    image={image.thumb}
                    alt={image.name}
                    sx={{ objectFit: "cover", objectPosition: "center" }}
                />
                <CardContent
                    sx={{
                        display: "flex",
                        flexDirection: "column",
                        flexGrow: 1,
                    }}
                >
                    <Box
                        sx={{ display: "flex", alignItems: "center", gap: 0.5 }}
                    >
                        <Typography
                            variant="h6"
                            noWrap
                            sx={
                                !image.active
                                    ? { color: visColors.inactive }
                                    : undefined
                            }
                        >
                            {image.name}
                        </Typography>
                        {!image.active && !onToggleVisibility && (
                            <Tooltip title="Visibility: Inactive">
                                <span
                                    role="img"
                                    aria-label="Visibility: Inactive"
                                    style={{ display: "inline-flex" }}
                                >
                                    <VisibilityOff
                                        fontSize="small"
                                        sx={{ color: visColors.inactive }}
                                    />
                                </span>
                            </Tooltip>
                        )}
                    </Box>
                    {image.copyright && (
                        <Typography
                            variant="body2"
                            color="text.secondary"
                            noWrap
                            sx={{ mt: 1 }}
                        >
                            &copy; {image.copyright}
                        </Typography>
                    )}
                    <Box sx={{ flexGrow: 1 }} />
                </CardContent>
            </CardActionArea>
        </Card>
    );
}
