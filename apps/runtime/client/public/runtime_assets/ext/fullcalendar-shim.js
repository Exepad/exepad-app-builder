/**
 * FullCalendar extension shim (dev mode)
 *
 * esm.sh ships FullCalendar core, plugins, and React wrapper as separate packages.
 * The production CDN bundle combines them all, but in dev we need this shim to
 * re-export from each package so @exepad/ext-fullcalendar has the full API.
 */
export * from 'https://esm.sh/@fullcalendar/react@6?external=react,react-dom';
export { default } from 'https://esm.sh/@fullcalendar/react@6?external=react,react-dom';
export { default as dayGridPlugin } from 'https://esm.sh/@fullcalendar/daygrid@6';
export { default as timeGridPlugin } from 'https://esm.sh/@fullcalendar/timegrid@6';
export { default as interactionPlugin } from 'https://esm.sh/@fullcalendar/interaction@6';
export { default as listPlugin } from 'https://esm.sh/@fullcalendar/list@6';
