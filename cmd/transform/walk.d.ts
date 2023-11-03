declare module "@root/walk" {
  import { Stats } from "fs";
  namespace Walk {
    export type WalkFunc = (
      err: Error,
      pathname: string,
      dirent: Stats
    ) => Promise<void>;
    export type CreateOpts = {
      withFileStats?: boolean;
      sort?: (entities: any[]) => any[];
    };
    export function create(opts: CreateOpts): Promise<void>;
    export function walk(pathname: string, walkFunc: WalkFunc): Promise<void>;
  }
  export default Walk;
}
