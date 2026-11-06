# Google setup (Ruben does every step, ~15 min 🤔)

Claude never creates accounts or types credentials. The client ID you copy at the end is **public config, not a
secret**: it only works from the web addresses you list in step 5, and only for the test users in step 3.

Replace `cytry47.github.io` below if the site ends up somewhere else.

## 1. Create a Cloud project
1. Open https://console.cloud.google.com/ and sign in with the Google account that owns "3D Assets".
2. Top bar: project picker -> **New project**.
3. Name: `glb-viewer`. Organization: leave as is ("No organization" is fine). **Create**.
4. Make sure the project picker now shows `glb-viewer`.

## 2. Turn on the Drive API
1. Menu -> **APIs & Services** -> **Library**.
2. Search `Google Drive API` -> open it -> **Enable**.

## 3. OAuth consent screen (Testing mode)
1. Menu -> **APIs & Services** -> **OAuth consent screen** (may be called **Google Auth Platform** -> **Branding**).
2. **Get started** (or **Configure consent screen**).
3. App name: `GLB Library`. User support email: yours. **Next**.
4. Audience: **External**. **Next**.
5. Contact email: yours. **Next**, tick the policy box, **Create**.
6. Go to **Audience** (or the "Test users" part of the consent screen):
   - Publishing status must stay **Testing**. Do NOT press "Publish app".
   - **Test users** -> **Add users** -> add your own Gmail and Aeryn's Gmail -> **Save**.
   - Later devs: add their Gmail here (max 100).
7. Go to **Data access** (or **Scopes**) -> **Add or remove scopes** -> filter `drive.readonly` -> tick
   `.../auth/drive.readonly` (See and download all your Google Drive files) -> **Update** -> **Save**.

Why `drive.readonly`: it is the smallest scope that can list a shared folder AND download the GLB bytes.
The site never writes anything. In Testing mode Google shows an "unverified app" warning on sign-in:
click **Continue**. That is expected and fine for a private tool.

## 4. (Nothing to do) Testing-mode limits
- Only the listed test users can sign in.
- A sign-in lasts 1 hour; after that the site shows "Sign in again" (one click).

## 5. Create the Web client ID
1. Menu -> **APIs & Services** -> **Credentials** (or **Google Auth Platform** -> **Clients**).
2. **Create credentials** -> **OAuth client ID** (or **Create client**).
3. Application type: **Web application**. Name: `glb-viewer web`.
4. **Authorized JavaScript origins** -> **Add URI**, add both:
   - `https://cytry47.github.io`
   - `http://localhost:4231`
5. **Authorized redirect URIs**: leave empty (the token flow does not use them).
6. **Create**. Copy the **Client ID** (ends in `.apps.googleusercontent.com`).
   There is also a "client secret": ignore it, the site does not use it. Do not paste it anywhere.

## 6. Give the client ID to the code chat
Paste the Client ID into the GLB VIEWER chat (or into `config.js`, `CLIENT_ID = '...'`).
New origins (e.g. another domain later) are added in step 5.4; changes can take a few minutes to apply.

## 7. Share the Drive folder with Aeryn (and later devs)
1. Drive -> right-click **3D Assets** -> **Share**.
2. Add Aeryn's Gmail as **Viewer**. Uncheck "Notify" if you like.
3. The site shows each person only what Drive shares with them.
4. Turning off "Anyone with the link": only after the GLB VIEWER chat confirms nothing in Ruben HQ loads files from
   that link (it checks this for you).

## 8. Use it
1. Open the site -> **Sign in with Google** -> pick your account -> **Continue** past the unverified warning ->
   allow "See and download your Google Drive files".
2. Paste the "3D Assets" folder link (Drive -> Share -> Copy link) -> **Open**.
3. First listing of 2,808 files takes a little while; after that it is cached. **Refresh** picks up new uploads.
