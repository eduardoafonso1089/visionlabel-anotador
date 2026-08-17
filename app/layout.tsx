import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const sans=Geist({variable:"--sans",subsets:["latin"]});
const mono=Geist_Mono({variable:"--mono",subsets:["latin"]});
export const metadata:Metadata={title:"Epiaka — Anotação de Imagens",description:"Anote imagens para treinar modelos de visão computacional e exporte em COCO ou YOLO.",other:{"codex-preview":"development"},icons:{icon:"/epiaka-favicon.svg"}};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="pt-BR"><body className={`${sans.variable} ${mono.variable}`}>{children}</body></html>}
