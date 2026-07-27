import * as React from 'react';

export type UseFakeStreamOptions = {
  mode?: 'char' | 'word';
  charDelay?: number;
  wordDelay?: number;
  jitter?: number;
  autoStart?: boolean;
  onDone?: () => void;
};

export type UseFakeStreamReturn = {
  text: string;
  isStreaming: boolean;
  isDone: boolean;
  progress: number;
  start: () => void;
  stop: () => void;
  reset: () => void;
  skip: () => void;
};

export function useFakeStream(
  source: string,
  opts: UseFakeStreamOptions = {},
): UseFakeStreamReturn {
  const {
    mode = 'char',
    charDelay = 18,
    wordDelay = 70,
    jitter = 0.35,
    autoStart = true,
    onDone,
  } = opts;

  const [text, setText] = React.useState('');
  const [isStreaming, setIsStreaming] = React.useState(false);
  const [isDone, setIsDone] = React.useState(false);
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const idxRef = React.useRef(0);
  const onDoneRef = React.useRef(onDone);
  onDoneRef.current = onDone;

  const tokens = React.useMemo(() => {
    if (mode === 'word') {
      const parts = source.split(/(\s+)/);
      return parts.filter((p) => p.length > 0);
    }
    return Array.from(source);
  }, [source, mode]);

  const baseDelay = mode === 'word' ? wordDelay : charDelay;

  const clearTimer = React.useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const tick = React.useCallback(() => {
    const i = idxRef.current;
    if (i >= tokens.length) {
      setIsStreaming(false);
      setIsDone(true);
      onDoneRef.current?.();
      return;
    }
    const next = tokens[i];
    idxRef.current = i + 1;
    setText((t) => t + next);
    const jitterDelta = jitter > 0 ? (Math.random() * 2 - 1) * jitter : 0;
    const delay = Math.max(0, baseDelay * (1 + jitterDelta));
    timerRef.current = setTimeout(tick, delay);
  }, [tokens, baseDelay, jitter]);

  const start = React.useCallback(() => {
    clearTimer();
    setIsStreaming(true);
    setIsDone(false);
    timerRef.current = setTimeout(tick, baseDelay);
  }, [clearTimer, tick, baseDelay]);

  const stop = React.useCallback(() => {
    clearTimer();
    setIsStreaming(false);
  }, [clearTimer]);

  const reset = React.useCallback(() => {
    clearTimer();
    idxRef.current = 0;
    setText('');
    setIsStreaming(false);
    setIsDone(false);
  }, [clearTimer]);

  const skip = React.useCallback(() => {
    clearTimer();
    idxRef.current = tokens.length;
    setText(source);
    setIsStreaming(false);
    setIsDone(true);
    onDoneRef.current?.();
  }, [clearTimer, tokens.length, source]);

  React.useEffect(() => {
    if (autoStart) {
      reset();
      setIsStreaming(true);
      timerRef.current = setTimeout(tick, baseDelay);
    }
    return () => clearTimer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, mode]);

  const progress = tokens.length === 0 ? 1 : idxRef.current / tokens.length;

  return { text, isStreaming, isDone, progress, start, stop, reset, skip };
}
