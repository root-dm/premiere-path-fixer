# Premiere Path Fixer

A small, browser-based tool for replacing media path prefixes in Adobe Premiere Pro `.prproj` files. It helps when a project is moved between computers, drives, or operating systems and Premiere shows clips as offline even though the media is present.

Premiere saves full paths to source files in the project. If a project refers to `/Volumes/MediaDrive/Footage/clip.mp4` but the same file now lives at `D:\Footage\clip.mp4`, replace `/Volumes/MediaDrive` with `D:\`. The tool updates matching path references, preserves the rest of the project XML, and downloads a new `.prproj` file. It also works from Windows to macOS and between drives on the same system.

## Use

1. Open `index.html` in a current browser, or host it as a static page.
2. Choose a copy of your `.prproj` file.
3. Enter the path prefix currently saved in the project and the new prefix where the same files live.
4. Preview the number of matching references and an example change.
5. Download the fixed `.prproj` and open it in Premiere Pro.

The file is processed locally in your browser; there is no server-side upload. The tool reads gzip-compressed Premiere XML, changes matching path prefixes, then writes a gzip-compressed `.prproj` copy. Uncompressed XML projects are also accepted. The input file limit is 100 MB.

## Limitations

- The remaining folder structure and filenames must still match. This tool cannot restore missing files or correct renamed folders automatically.
- One prefix replacement is applied at a time. For another unrelated prefix, run the downloaded copy through the tool again.
- Keep the original project as a backup. Confirm the result by opening the downloaded copy in Premiere Pro.
