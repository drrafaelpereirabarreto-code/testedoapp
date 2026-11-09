"use client";

// Mostra a imagem ou o vídeo do anúncio. Links de mídia do Facebook expiram depois de alguns dias:
// quando isso acontece, aparece um aviso com o link para ver na Biblioteca de Anúncios.
import { useState } from "react";

interface Props {
  imagem: string | null;
  video?: string | null;
  capa?: string | null;
  alt: string;
  biblioteca?: string;
  tocarVideo?: boolean;
  className?: string;
}

export default function Midia({ imagem, video, capa, alt, biblioteca, tocarVideo = false, className = "" }: Props) {
  const [falhou, setFalhou] = useState(false);
  const fonteImagem = capa || imagem;

  if (falhou || (!fonteImagem && !video)) {
    return (
      <div className={`flex flex-col items-center justify-center gap-2 bg-painel-2 p-4 text-center text-xs text-texto-3 ${className}`}>
        <span aria-hidden className="text-2xl">🖼️</span>
        <span>Mídia indisponível (o link do Facebook expira).</span>
        {biblioteca && (
          <a href={biblioteca} target="_blank" rel="noreferrer" className="text-destaque-forte underline">
            Ver na Biblioteca
          </a>
        )}
      </div>
    );
  }

  if (video && tocarVideo) {
    return (
      <video
        src={video}
        poster={fonteImagem ?? undefined}
        controls
        playsInline
        preload="metadata"
        className={`bg-black object-contain ${className}`}
        onError={() => setFalhou(true)}
      />
    );
  }

  return (
    <div className={`relative overflow-hidden bg-painel-2 ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={fonteImagem ?? ""}
        alt={alt}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="h-full w-full object-cover"
        onError={() => setFalhou(true)}
      />
      {video && (
        <span className="absolute bottom-2 left-2 rounded-md bg-black/70 px-2 py-0.5 text-xs font-semibold text-white">
          ▶ vídeo
        </span>
      )}
    </div>
  );
}
