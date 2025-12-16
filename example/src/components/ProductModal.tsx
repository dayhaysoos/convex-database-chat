import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";

interface ProductModalProps {
  productId: string;
  onClose: () => void;
}

export function ProductModal({ productId, onClose }: ProductModalProps) {
  const product = useQuery(api.products.getProduct, {
    id: productId as Id<"products">,
  });

  // Handle click outside to close
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Handle escape key
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    }
  };

  return (
    <div
      className="modal-backdrop"
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div className="modal-content">
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>

        {product === undefined ? (
          <div className="modal-loading">
            <div className="loading-spinner"></div>
            <p>Loading product...</p>
          </div>
        ) : product === null ? (
          <div className="modal-error">
            <h2>Product Not Found</h2>
            <p>
              The product you're looking for doesn't exist or has been removed.
            </p>
            <button className="modal-button" onClick={onClose}>
              Go Back
            </button>
          </div>
        ) : (
          <div className="modal-product">
            <div className="modal-product-image">
              <div className="product-placeholder-image">
                <span className="placeholder-icon">📦</span>
                <span className="placeholder-text">Product Image</span>
              </div>
            </div>

            <div className="modal-product-details">
              <span className="modal-category">{product.category}</span>
              <h2 className="modal-product-name">{product.name}</h2>
              <p className="modal-product-description">{product.description}</p>

              <div className="modal-product-meta">
                <div className="modal-price">${product.price.toFixed(2)}</div>
                <div
                  className={`modal-stock ${product.stock < 10 ? "low" : ""} ${product.stock === 0 ? "out" : ""}`}
                >
                  {product.stock > 0
                    ? `${product.stock} in stock`
                    : "Out of stock"}
                </div>
              </div>

              <div className="modal-actions">
                <button
                  className="modal-button primary"
                  disabled={product.stock === 0}
                >
                  {product.stock > 0 ? "Add to Cart" : "Out of Stock"}
                </button>
                <button className="modal-button secondary" onClick={onClose}>
                  Continue Shopping
                </button>
              </div>

              <div className="modal-product-id">
                <span>Product ID:</span>
                <code>{product._id}</code>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
