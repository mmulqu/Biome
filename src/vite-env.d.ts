/// <reference types="vite/client" />

declare module '*.css' {
  const content: string;
  export default content;
}

declare module 'leaflet/dist/leaflet.css' {
  const content: string;
  export default content;
}

declare module '*.png' {
  const src: string;
  export default src;
}

declare module 'leaflet/dist/images/*.png' {
  const src: string;
  export default src;
}
