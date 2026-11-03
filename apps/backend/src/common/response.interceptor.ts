import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { PageMeta, Paginated } from './pagination';

export type ApiSuccess<T> = { success: true; data: T; meta?: PageMeta };

/** Wraps every successful response as `{ success: true, data, meta? }`. */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(_: ExecutionContext, next: CallHandler): Observable<ApiSuccess<unknown>> {
    return next
      .handle()
      .pipe(
        map((body) =>
          body instanceof Paginated
            ? { success: true, data: body.items, meta: body.meta }
            : { success: true, data: body ?? null },
        ),
      );
  }
}
