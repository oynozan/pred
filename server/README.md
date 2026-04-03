There are 2 types of JWT tokens:

1) User authentication
2) Webhook / server-to-server authentication

For server-to-server authentication, a keyfile is needed. For user authentication, a random string is enough.

## How to create a keyfile for server-only auth?
Run these commands in order:

`mkdir keys`

`openssl ecparam -name prime256v1 -genkey -noout -out keys/server-private.pem`

`openssl pkcs8 -topk8 -inform PEM -outform PEM -nocrypt -in keys/server-private.pem -out keys/server-private-pkcs8.pem`

`openssl ec -in keys/server-private.pem -pubout -out keys/server-public.pem`

Create a JWT token at jwt.io.

Use `server-private-pkcs8.pem` for private key and set the algorithm to `ES256`

Update `.env`:
```conf
PUBLIC_KEY_PATH="/path/to/keys/server-public.pem"
JWT_ISSUER="issuer_name"
```

## How to create a JWT token for user auth?
Generate a JWT secret `openssl rand -hex 32`

Update `.env`:
```conf
JWT_SECRET="YOUR_SECRET"
```

Request cookie must contain `auth:ENCODED_JWT_TOKEN` encrypted with `process.env.JWT_SECRET`
