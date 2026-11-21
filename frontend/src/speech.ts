import { useEffect, useRef, useState } from 'react'

type Recognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult:
    | ((e: {
        results: ArrayLike<
          ArrayLike<{ transcript: string }> & { isFinal: boolean }
        >
      }) => void)
    | null
  onerror: (() => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
const speechWindow = window as Window & {
  SpeechRecognition?: new () => Recognition
  webkitSpeechRecognition?: new () => Recognition
}
const Speech =
  speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition

export function useSpeech(send: (text: string) => void) {
  const active = useRef<Recognition | null>(null)
  const stopping = useRef(false)
  const sendRef = useRef(send)
  sendRef.current = send
  const [recording, setRecording] = useState(false)
  const [feedback, setFeedback] = useState('')
  const stop = () => {
    if (!active.current || stopping.current) return
    stopping.current = true
    setRecording(false)
    try {
      active.current.stop()
    } catch {
      active.current.abort()
    }
  }
  useEffect(() => {
    window.addEventListener('blur', stop)
    return () => {
      window.removeEventListener('blur', stop)
      if (active.current) {
        active.current.onend = active.current.onerror = null
        active.current.abort()
      }
    }
  }, [])

  function start() {
    if (!Speech || active.current) return
    const recognizer = new Speech()
    active.current = recognizer
    stopping.current = false
    recognizer.lang = 'en-US'
    recognizer.interimResults = true
    recognizer.continuous = true
    let transcript = ''
    let failed = false
    recognizer.onresult = ({ results }) => {
      transcript = Array.from(results)
        .map((result) => result[0].transcript)
        .join(' ')
        .trim()
      setFeedback(transcript)
    }
    recognizer.onerror = () => {
      failed = true
      setFeedback('Voice recognition unavailable. Type your message below.')
    }
    recognizer.onend = () => {
      active.current = null
      setRecording(false)
      if (!failed && transcript) sendRef.current(transcript.slice(0, 240))
      else if (!failed) setFeedback('No speech detected. Hold to try again.')
    }
    try {
      setFeedback('')
      setRecording(true)
      recognizer.start()
    } catch {
      active.current = null
      setFeedback('Voice recognition unavailable. Type your message below.')
    }
  }
  return { supported: !!Speech, recording, feedback, start, stop }
}
