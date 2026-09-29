// Side effect imports of plain styles and binary assets (Vite resolves them;
// TypeScript only needs to know they exist).
declare module '*.css';
declare module '*.scss';
declare module '*.woff';
declare module '*.woff2';
declare module '*.png';

// For CSS
declare module '*.module.css' {
  const classes: { [key: string]: string };
  export default classes;
}

// For LESS
declare module '*.module.less' {
  const classes: { [key: string]: string };
  export default classes;
}

// For SCSS
declare module '*.module.scss' {
  const classes: { [key: string]: string };
  export default classes;
}
