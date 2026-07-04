/** @type {import('tailwindcss').Config} */
export default {
    content: ['./index.html', './login.html', './library.html'],
    darkMode: 'class',
    theme: {
        extend: {
            fontFamily: {
                sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
            },
        },
    },
    plugins: [],
};
