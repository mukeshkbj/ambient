# Ambient privacy policy

Ambient makes phone calls on behalf of one household. It receives requests from the owner's Alexa skill and MCP clients, calls the business the owner names, and reports the result.

## What Ambient stores

Ambient stores data in a SQLite file on the owner's own server:

- The owner's instructions and the status of each call.
- The call transcript: what the agent said, what the business said, and the owner's notes.
- The outcome of each call and short facts the agent remembers about a business, such as a call-out fee.
- Pending approvals until the owner answers them.

Ambient deletes finished call runs after `AMBIENT_RETENTION_DAYS` days. Call history and remembered facts stay until the owner deletes them. The owner can delete the data directory at any time.

## Who receives data

- **Anthropic** receives the call transcript to decide what the agent says next.
- **AssemblyAI** receives the call audio when the voice line is in use. It transcribes the business and speaks the agent's words.
- **The business** hears the agent. The first sentence of every call tells the business that the caller is an AI and that the call is transcribed.

Ambient never sells or shares data with any other party. Ambient removes every run of 12 or more digits from what the agent says, and the agent is instructed never to give card numbers, account numbers, or passwords.

## Contact

This is a hackathon notice for a single-owner deployment. Replace it with a hosted policy and contact details before a public Alexa skill is published.
