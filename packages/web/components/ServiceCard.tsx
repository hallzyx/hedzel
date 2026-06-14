"use client";

import type { CatalogService } from "@/lib/api";

export function ServiceCard({
  service,
  onTry,
  index,
}: {
  service: CatalogService;
  onTry: (service: CatalogService) => void;
  index: number;
}) {
  return (
    <div
      className="card"
      style={{ animationDelay: `${index * 60}ms` }}
      onClick={() => onTry(service)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onTry(service)}
    >
      <div className="card-head">
        <h3>{service.name}</h3>
        <span className="price">
          {service.price.amount} {service.price.currency}
        </span>
      </div>
      <p>{service.description}</p>
      <div className="try">Try it →</div>
    </div>
  );
}
