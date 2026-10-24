/**
 * @tryghost/admin-api does not publish official types. We type only the surface
 * we use; everything else falls into `any` on purpose.
 */
declare module '@tryghost/admin-api' {
  interface GhostAdminAPIOptions {
    url: string;
    key: string;
    version: string;
  }

  interface BrowseParams {
    filter?: string;
    formats?: string;
    include?: string;
    limit?: number;
    page?: number;
    order?: string;
    fields?: string;
  }

  interface ReadParams {
    id?: string;
    slug?: string;
  }

  interface ReadOptions {
    formats?: string;
    include?: string;
  }

  interface EditOptions {
    source?: string;
    // Passed as-is as axios query params (see lib/admin-api.js: edit()).
    save_revision?: boolean;
  }

  interface ImageUploadInput {
    file: string;
    ref?: string;
    purpose?: 'image' | 'profile_image' | 'icon';
  }

  export default class GhostAdminAPI {
    constructor(options: GhostAdminAPIOptions);
    posts: {
      browse(params?: BrowseParams): Promise<any[] & { meta?: { pagination?: { pages: number; total: number } } }>;
      read(params: ReadParams, options?: ReadOptions): Promise<any>;
      add(data: Record<string, unknown>, options?: EditOptions): Promise<any>;
      edit(data: Record<string, unknown>, options?: EditOptions): Promise<any>;
      delete(params: { id: string }): Promise<any>;
    };
    images: {
      upload(input: ImageUploadInput): Promise<{ url: string; ref?: string }>;
    };
    tags: {
      browse(params?: BrowseParams): Promise<any[]>;
    };
  }
}
