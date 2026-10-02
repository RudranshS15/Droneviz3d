/**
 * video-file.ts — is this dropped file a video the browser can decode?
 *
 * The browser is the only real judge of what it can play, and on the drop path
 * neither of the usual guards is trustworthy: `accept` only filters the
 * file-picker dialog (drops bypass it entirely), and Chrome on Windows reports
 * an *empty* MIME type for containers it plays perfectly well (.mkv, some
 * .avi). Judging by type alone therefore rejected playable files silently —
 * the drop did nothing, which reads as a broken page.
 *
 * So: MIME type OR a known extension, and a rejection that names the file and
 * the accepted formats.
 */

const ACCEPTED_EXTENSIONS = ['mp4', 'mov', 'avi', 'mkv', 'webm']

export interface UploadCandidate {
  type: string
  name: string
}

/** null when the file looks uploadable, otherwise a message naming the file and the formats. */
export function videoFileError(file: UploadCandidate): string | null {
  const dot = file.name.lastIndexOf('.')
  const extension = dot === -1 ? '' : file.name.slice(dot + 1).toLowerCase()
  const looksLikeVideo =
    file.type.startsWith('video/') || ACCEPTED_EXTENSIONS.includes(extension)
  if (looksLikeVideo) return null
  return `“${file.name}” is not a video file. Upload MP4, MOV, AVI, MKV or WebM.`
}
