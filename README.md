# bixie <@_@>

Quick infinite scroll webpage generator for media galleries.

Files are content-addressed (renamed to their SHA-256 hash) in the output. Videos autoplay when scrolled into view and pause when scrolled away.

## Install

```bash
npm i -g bixie
```

## Usage

```bash
bixie [options] <source-directory>
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--dist <path>` | `./dist` | Output directory |
| `--title <text>` | `Media Gallery` | Page title |
| `--autoplay <bool>` | `true` | Autoplay videos on scroll |
| `--muted <bool>` | `false` | Mute videos |
| `--loop <bool>` | `true` | Loop videos |
| `--controls <bool>` | `true` | Show video controls |
| `--per-page <n>` | `5` | Items loaded per scroll |
| `--threshold <n>` | `0.5` | Visibility ratio to trigger autoplay (0-1) |
| `--help` | | Show help message |

### Examples

```bash
# Generate gallery from a folder of memes
bixie ~/Downloads/memes

# Specify output directory and title
bixie --dist ~/www/gallery --title "Robot Files" ~/media/robots

# Muted autoplay (guaranteed to work in all browsers)
bixie --muted ~/media/clips

# Disable autoplay, just show videos with controls
bixie --autoplay false ~/media/clips
```

### Supported Formats

- **Images:** jpg, png, gif, webp
- **Videos:** mp4, webm, ogg

### Note on Autoplay

Browsers require videos to be muted for autoplay to work without prior
user interaction. By default bixie sets `--muted false` so videos have
sound, but autoplay may be blocked by the browser until the user interacts
with the page. Use `--muted` to guarantee autoplay works everywhere.

## Output

Running bixie produces a self-contained directory with:

- `index.html` - the gallery page
- `index.json` - file metadata
- `files/` - content-addressed media files

Serve the output directory with any static file server.

## What Is Bixie?

bixie /bik'see/ n.
Alternative emoticons used on BIX (the BIX Information eXchange).
The most common (smiley) bixie is <@_@>, representing two
cartoon eyes and a mouth. These were originally invented in an SF
fanzine called APA-L and imported to BIX by one of the earliest users.

(from esr's jargon file)
