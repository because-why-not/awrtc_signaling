// @ts-check

import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: [
            'out/**/*.*',
        ],
    },
    eslint.configs.recommended,
    {
        extends: tseslint.configs.recommendedTypeChecked,
        rules: {
            "@typescript-eslint/no-require-imports": [
                "error",
                {
                    "allow": [
                        "/config.json$"
                    ]
                }
            ]
        }
    },
    {
        languageOptions: {
            parserOptions: {
                projectService: {
                    allowDefaultProject: ['*.mjs'],
                },
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
);