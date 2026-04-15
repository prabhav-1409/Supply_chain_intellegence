import { useEffect, useRef } from 'react'

// WebGL-based ambient particle field for cinematic boardroom depth
export default function AmbientBackground({ intensity = 1.0 }) {
  const canvasRef = useRef(null)
  const animRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl', { alpha: true, antialias: false })
    if (!gl) return

    const resize = () => {
      canvas.width = canvas.offsetWidth
      canvas.height = canvas.offsetHeight
      gl.viewport(0, 0, canvas.width, canvas.height)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const POINT_COUNT = 180

    const positions = new Float32Array(POINT_COUNT * 2)
    const velocities = new Float32Array(POINT_COUNT * 2)
    const sizes = new Float32Array(POINT_COUNT)
    const alphas = new Float32Array(POINT_COUNT)

    for (let i = 0; i < POINT_COUNT; i++) {
      positions[i * 2] = Math.random() * 2 - 1
      positions[i * 2 + 1] = Math.random() * 2 - 1
      velocities[i * 2] = (Math.random() - 0.5) * 0.0003
      velocities[i * 2 + 1] = (Math.random() - 0.5) * 0.0003
      sizes[i] = Math.random() * 2.5 + 0.5
      alphas[i] = Math.random() * 0.6 + 0.1
    }

    const vertexSrc = `
      attribute vec2 a_position;
      attribute float a_size;
      attribute float a_alpha;
      varying float v_alpha;
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        gl_PointSize = a_size;
        v_alpha = a_alpha;
      }
    `
    const fragSrc = `
      precision mediump float;
      varying float v_alpha;
      void main() {
        vec2 coord = gl_PointCoord - vec2(0.5);
        float r = dot(coord, coord);
        if (r > 0.25) discard;
        float fade = 1.0 - smoothstep(0.1, 0.25, r);
        gl_FragColor = vec4(0.05, 0.8, 1.0, v_alpha * fade * 0.55);
      }
    `

    const compile = (type, src) => {
      const shader = gl.createShader(type)
      gl.shaderSource(shader, src)
      gl.compileShader(shader)
      return shader
    }

    const program = gl.createProgram()
    gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSrc))
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragSrc))
    gl.linkProgram(program)
    gl.useProgram(program)

    const posBuffer = gl.createBuffer()
    const sizeBuffer = gl.createBuffer()
    const alphaBuffer = gl.createBuffer()

    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE)

    const posLoc = gl.getAttribLocation(program, 'a_position')
    const sizeLoc = gl.getAttribLocation(program, 'a_size')
    const alphaLoc = gl.getAttribLocation(program, 'a_alpha')

    let frame = 0
    const tick = () => {
      frame++
      for (let i = 0; i < POINT_COUNT; i++) {
        positions[i * 2] += velocities[i * 2]
        positions[i * 2 + 1] += velocities[i * 2 + 1]
        if (positions[i * 2] > 1.05 || positions[i * 2] < -1.05) velocities[i * 2] *= -1
        if (positions[i * 2 + 1] > 1.05 || positions[i * 2 + 1] < -1.05) velocities[i * 2 + 1] *= -1
        // pulsate alpha
        alphas[i] = 0.1 + 0.4 * Math.abs(Math.sin(frame * 0.01 + i * 0.5))
      }

      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)

      gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW)
      gl.enableVertexAttribArray(posLoc)
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

      gl.bindBuffer(gl.ARRAY_BUFFER, sizeBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, sizes, gl.STATIC_DRAW)
      gl.enableVertexAttribArray(sizeLoc)
      gl.vertexAttribPointer(sizeLoc, 1, gl.FLOAT, false, 0, 0)

      gl.bindBuffer(gl.ARRAY_BUFFER, alphaBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, alphas, gl.DYNAMIC_DRAW)
      gl.enableVertexAttribArray(alphaLoc)
      gl.vertexAttribPointer(alphaLoc, 1, gl.FLOAT, false, 0, 0)

      gl.drawArrays(gl.POINTS, 0, POINT_COUNT)
      animRef.current = requestAnimationFrame(tick)
    }

    animRef.current = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(animRef.current)
      ro.disconnect()
    }
  }, [intensity])

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0,
        opacity: 0.45,
      }}
    />
  )
}
