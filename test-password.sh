#!/bin/bash
# test-password.sh - A script to test username/password authentication against the database.

# Check for required arguments
if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <username> <password>"
    exit 1
fi

USERNAME=$1
PASSWORD=$2
CONTAINER_NAME="z7note"

# Check if the container is running
if ! docker ps --filter "name=${CONTAINER_NAME}" --filter "status=running" | grep -q "${CONTAINER_NAME}"; then
    echo "Error: The container '${CONTAINER_NAME}' is not running."
    exit 1
fi

echo "Running authentication test for user '${USERNAME}' inside the container..."

# Execute the test script inside the Docker container
# Corrected Node.js argument parsing
docker exec "${CONTAINER_NAME}" node -e '
const { connect, getConnection, close } = require("./src/db/connection");
const bcrypt = require("bcrypt");

async function testAuth(username, password) {
    // This check now happens inside the Node.js script
    if (!username || !password) {
        console.error("Internal script error: Username or password was not received.");
        process.exit(1);
    }

    try {
        await connect();
        const db = getConnection();

        console.log(`Querying database for user: ${username}`);
        const user = await db.get("SELECT * FROM users WHERE username = ?", [username]);

        if (!user) {
            console.error("\n--- AUTHENTICATION FAILED ---");
            console.error(`Reason: User "${username}" not found in the database.`);
            await close();
            process.exit(1);
        }

        console.log(`User "${username}" found. Verifying password...`);
        const isValid = await bcrypt.compare(password, user.password);

        if (isValid) {
            console.log("\n--- AUTHENTICATION SUCCESSFUL ---");
            console.log("The provided username and password are correct.");
        } else {
            console.error("\n--- AUTHENTICATION FAILED ---");
            console.error("Reason: Password mismatch.");
        }

        await close();

    } catch (error) {
        console.error("\n--- AN ERROR OCCURRED ---");
        console.error(error.message);
        process.exit(1);
    }
}

// Corrected argument parsing for `node -e`
const username = process.argv[1];
const password = process.argv[2];
testAuth(username, password);
' -- "${USERNAME}" "${PASSWORD}"
