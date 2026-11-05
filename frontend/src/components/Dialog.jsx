import { Box, Dialog as MuiDialog, IconButton, Tooltip } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { gold, ink, stone } from '../theme';

const BG = '#fff';
const RADIUS = 28; // outer corners
const NOTCH = 84; // the cut-out top-right corner that holds the ✕ button
const CURVE = 28; // rounding where the card meets the notch
const BUTTON = 64;

// The card is painted from pieces so the notch is truly cut out and the page behind shows through:
// the left part stops short of the notch, the right strip starts below it, and a fillet rounds the inner corner.
function NotchedBackground() {
  const piece = { position: 'absolute', bgcolor: BG };
  return (
    <Box aria-hidden sx={{ position: 'absolute', inset: 0, zIndex: -1, filter: 'drop-shadow(0 18px 40px rgba(30,26,20,.22))' }}>
      <Box sx={{ ...piece, top: 0, bottom: 0, left: 0, right: NOTCH, borderRadius: `${RADIUS}px ${CURVE}px 0 ${RADIUS}px` }} />
      <Box sx={{ ...piece, top: NOTCH, bottom: 0, right: 0, width: NOTCH + RADIUS, borderRadius: `0 ${CURVE}px ${RADIUS}px 0` }} />
      <Box
        sx={{
          position: 'absolute', top: NOTCH - CURVE, right: NOTCH - CURVE, width: CURVE, height: CURVE,
          background: `radial-gradient(circle at 100% 0, transparent ${CURVE - 0.5}px, ${BG} ${CURVE}px)`,
        }}
      />
    </Box>
  );
}

// The app's popup window: a notched card with a round ✕ in the cut-out corner.
// It never closes from a click outside it or the Esc key, so a half-filled form is not lost by accident;
// only the ✕ button (or the form's own buttons) close it.
export default function Dialog({ onClose, children, sx, slotProps, ...props }) {
  const handleClose = (event, reason) => {
    if (reason === 'backdropClick' || reason === 'escapeKeyDown') return;
    onClose?.(event, reason);
  };

  return (
    <MuiDialog
      {...props}
      onClose={handleClose}
      sx={[
        {
          // A little roomier than MUI's standard widths.
          '& .MuiDialog-paperWidthXs': { maxWidth: 480 },
          '& .MuiDialog-paperWidthSm': { maxWidth: 680 },
          '& .MuiDialog-paperWidthMd': { maxWidth: 1000 },
          '& .MuiDialog-paper': { m: { xs: 1.5, sm: 4 }, width: { xs: 'calc(100% - 24px)', sm: 'calc(100% - 64px)' } },
          // Same side padding everywhere; the title stays clear of the notch.
          '& .MuiDialogTitle-root': {
            px: { xs: 2.5, sm: 4 }, pt: 3.5, pb: 2, pr: `${NOTCH + 12}px`, minHeight: NOTCH, boxSizing: 'border-box',
            '& .MuiTypography-root': { fontWeight: 400, mt: 0.5 },
          },
          '& .MuiDialogContent-root': { px: { xs: 2.5, sm: 4 }, pb: 3 },
          '& .MuiDialogActions-root': {
            px: { xs: 2.5, sm: 4 }, py: 2.5, gap: 1, borderTop: `1px solid ${stone[100]}`,
            '& > :not(style) ~ :not(style)': { ml: 0 },
          },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      slotProps={{
        ...slotProps,
        paper: {
          ...slotProps?.paper,
          sx: [
            { bgcolor: 'transparent', backgroundImage: 'none', boxShadow: 'none', borderRadius: `${RADIUS}px`, isolation: 'isolate' },
            ...[slotProps?.paper?.sx].flat(),
          ],
        },
      }}
    >
      <NotchedBackground />
      {onClose && (
        <Tooltip title="Close">
          <IconButton
            aria-label="Close"
            className="no-print"
            onClick={(e) => onClose(e, 'closeButton')}
            sx={{
              position: 'absolute', top: 0, right: 0, zIndex: 1, width: BUTTON, height: BUTTON,
              bgcolor: '#fff', color: ink, border: `1px solid ${stone[200]}`,
              transition: 'background-color .15s',
              // Spin only the icon: turning the whole button pushes its corners past the popup and makes it jump.
              '& svg': { transition: 'transform .2s' },
              '&:hover': { bgcolor: gold[50] },
              '&:hover svg': { transform: 'rotate(90deg)' },
            }}
          >
            <CloseIcon sx={{ fontSize: 28 }} />
          </IconButton>
        </Tooltip>
      )}
      {children}
    </MuiDialog>
  );
}
