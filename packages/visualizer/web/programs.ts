/** Submit independent shaders and programs together. Reading LINK_STATUS synchronizes with the
 * driver, so leave it until the program is first drawn, after scene textures have been prepared. */
export function webPrograms(gl: WebGL2RenderingContext) {
  const stages = new Map<string, WebGLShader>();
  function shader(type: number, source: string) {
    const cached = stages.get(source);
    if (cached) return cached;
    const handle = gl.createShader(type);
    if (!handle) throw new Error('Cannot allocate visualizer shader');
    gl.shaderSource(handle, source);
    gl.compileShader(handle);
    stages.set(source, handle);
    return handle;
  }
  return function program(vertex: string, fragment: string) {
    const handle = gl.createProgram();
    if (!handle) throw new Error('Cannot allocate visualizer program');
    gl.attachShader(handle, shader(gl.VERTEX_SHADER, vertex));
    gl.attachShader(handle, shader(gl.FRAGMENT_SHADER, fragment));
    gl.linkProgram(handle);
    // The selected scene may spend tens of milliseconds building textures on the CPU.
    // Send the link to the GPU process now so the driver can use that interval.
    gl.flush();
    let uniforms: Record<string, WebGLUniformLocation | null> | undefined;
    function prepare() {
      if (uniforms) return uniforms;
      if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) throw new Error('Visualizer program link failed: ' + gl.getProgramInfoLog(handle));
      const locations: Record<string, WebGLUniformLocation | null> = Object.create(null);
      const count = gl.getProgramParameter(handle, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < count; i++) {
        const info = gl.getActiveUniform(handle, i);
        if (info) locations[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(handle, info.name);
      }
      uniforms = new Proxy(locations, { get: (map, key: string) => map[key] ?? null });
      return uniforms;
    }
    return { p: handle, get u() { return prepare(); } };
  };
}
