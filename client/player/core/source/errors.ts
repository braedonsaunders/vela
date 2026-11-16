/** Scalar transport context survives bounded demux wrappers; never parse URLs
 * or an error message to decide whether a response retired a media generation. */
export function mediaHTTPStatus(error:unknown):number|null{
  for(let depth=0;depth<8&&error&&typeof error==='object';depth++){
    const value=error as {httpStatus?:unknown;cause?:unknown};
    if(typeof value.httpStatus==='number'&&Number.isInteger(value.httpStatus)&&value.httpStatus>=100&&value.httpStatus<=599)return value.httpStatus;
    error=value.cause;
  }
  return null;
}
