/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: "ts-jest",
    testEnvironment: "node",
    testMatch: ["<rootDir>/test/**/*.test.ts"],
    testPathIgnorePatterns: ["/dist/", "/node_modules/"],
    setupFiles: ["dotenv/config"],
    maxWorkers: 1,
    globals: {
        "ts-jest": {
            tsconfig: "tsconfig.jest.json",
        },
    },
};

